/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { FluxDispatcher, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { DEFAULT_FOLDER_STEP, Folder, FolderMap, getFolders } from "./folders";
import { FolderPreviewGif, GifMap, RawGif, TrendingCategory } from "./types";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const folderGifPreviews = new Map<number, FolderPreviewGif>();

export function getFolderPreviewGifs(folders: FolderMap) {
    const categories: TrendingCategory[] = []
    for (const { idx, name } of Object.values(folders)) {
        const gif = folderGifPreviews.get(idx);

        categories.push({
            name: name,
            type: "Favorites",
            src: gif?.src ?? "",
            format: gif?.format ?? 1
        })
    }

    return categories;
}

function setFolderPreview(idx: number, preview: FolderPreviewGif) {
    folderGifPreviews.set(idx, preview);
}

export function getFolderPreviewGifsEx() {
    const allGifs = getAllLocalGifs();
    const folders = getFolders();
    if (!allGifs || Object.keys(folders).length === 0) return {}

    const needPreview = new Set(
      Object.values(folders).map(folder => Math.floor(folder.start / DEFAULT_FOLDER_STEP))
    );

    console.log("fuckders:", needPreview);


}

// We are keeping a local copy of the remote gifs, because the local one gets modified with the new orders
// I think discord retries request on rate-limit or others, so technically this should stay in sync fully?
let remoteTimer: NodeJS.Timeout | null;
let remoteGifs: GifMap = {};

// patch endpoint is rate limited pretty annoyingly
function scheduleRemoteFlush() {
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(flushRemoteGifs, 3000);
}

export function addRemoteGif(gif: RawGif) {
    if (gif.url in remoteGifs) return;

    const { url, ...rest } = gif;
    const order = Object.values(remoteGifs).reduce((h, g) => Math.max(h, g.order), 0) + 1;
    remoteGifs[url] = { ...rest, order };

    scheduleRemoteFlush();
}

export function deleteRemoteGif(gif: RawGif) {
    if (!(gif.url in remoteGifs)) return

    delete remoteGifs[gif.url];

    scheduleRemoteFlush();
}

function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) {
        new Logger("GifFolders").error("Failed to key in gifStore");
        return undefined;
    }
    return `GifFolders:gif:${id}`;
}

function getNextOrderForGif(folder: Folder, allGifs: GifMap): number {
    const max = Object.values(allGifs)
        .filter(g => g.order >= folder.start && g.order < folder.end)
        .reduce((h, g) => Math.max(h, g.order), folder.start - 1);

    if (max >= folder.end - 1) {
        throw new Error("Folder is too full"); // should be impossible to reach, but just in case
    }

    return max + 1;
}

async function updateLocalGifs(gifs: GifMap) {
    const key = getKey();
    if (!key) return;

    await DataStore.set(key, gifs);
}


export function cleanGif(gif: RawGif) {
    const cleaned = { ...gif, url: gif.url.split("?")[0] };
    return cleaned;
}


export async function setFolderPreviewGifs(gifs?: GifMap) {
    const allGifs = gifs || await getAllLocalGifs();
    if (!allGifs) return;

    const seen = new Set();
    for (const { format, src, order } of Object.values(allGifs)) {
        const folderIdx = Math.floor(order / DEFAULT_FOLDER_STEP);
        if (seen.has(folderIdx)) continue;
        seen.add(folderIdx);

        folderGifPreviews.set(folderIdx, { format: format, src: src });
    }

    return folderGifPreviews;
}

export async function addLocalGif(folder: Folder, rawGif: RawGif) {
    const allGifs = await getAllLocalGifs();
    if (!allGifs) return;

    const { url, ...rest } = rawGif;

    const nextOrder = getNextOrderForGif(folder, allGifs);
    allGifs[url] = { ...rest, order: nextOrder };

    await updateLocalGifs(allGifs);
    refreshLocalStaleGifs(); // reschedule with new expiry

    setFolderPreview(folder.idx, { src: rest.src, format: rest.format });

    return allGifs;
}

export async function deleteLocalGif(rawGif: RawGif) {
    const allGifs = await getAllLocalGifs();
    if (allGifs && rawGif.url in allGifs) {
        delete allGifs[rawGif.url];
        await updateLocalGifs(allGifs);
    }

    // rebuild previews from scratch
    await setFolderPreviewGifs(allGifs);
    return allGifs;
}

// Need to use the RestApi because FrecencyAC.getCurrentValue()
// return the local array of gifs (affected by FluxDispatcher)
export async function getAllRemoteGifs(): Promise<GifMap | undefined> {
    const { ok, status, body } = await RestAPI.get({
        url: "/users/@me/settings-proto/2"
    });

    if (!ok || status !== 200 || !body?.settings)
        return undefined;

    const bytes = Uint8Array.from(atob(body.settings), c => c.charCodeAt(0));
    const end = FrecencyAC.ProtoClass.fromBinary(bytes, BINARY_READ_OPTIONS);

    if (!end.favoriteGifs || !end.favoriteGifs.gifs)
        return undefined;

    return end.favoriteGifs.gifs;
}


async function refreshSrcs(gifs: GifMap) {
    const srcToKey = new Map<string, string>();
    for (const [key, gif] of Object.entries(gifs)) {
        srcToKey.set(gif.src, key);
    }

    const srcs = Array.from(srcToKey.keys());
    const result = { ...gifs };

    // the endpoint allows up to 50 url's at once, so this has to be batched
    for (let i = 0; i < srcs.length; i += 50) {
        const chunk = srcs.slice(i, i + 50);

        // shouldn't be able to reach rate limiting with the await
        const { ok, body } = await RestAPI.post({
            url: "/attachments/refresh-urls",
            body: { attachment_urls: chunk }
        });

        if (!ok || !body?.refreshed_urls) continue;

        for (const { original, refreshed } of body.refreshed_urls) {
            const key = srcToKey.get(original);
            if (key) result[key] = { ...result[key], src: refreshed };
        }
    }

    console.log("Updated srcs are from local: ", result);
    return result;
}

// gifs we grab have an expiry date of 24h
// discord automatically refreshes the one held in remote, but we also need to update local ones
export async function refreshLocalStaleGifs() {
    if (refreshTimer) clearTimeout(refreshTimer);

    const localGifs = await getAllLocalGifs();
    if (!localGifs) return;

    const NEXT_DAY = 1000 * 60 * 60 * 24
    let msTillNextRefresh = NEXT_DAY;

    for (const [url, gif] of Object.entries(localGifs)) {
        const parsedUrl = new URL(gif.src);
        if (parsedUrl.hostname !== "media.discordapp.net") continue

        const ex = parsedUrl.searchParams.get("ex")
        if (!ex) continue;

        const epochSecondsEx = parseInt(ex, 16);
        const msTillExpiry = epochSecondsEx * 1000 - Date.now();
        msTillNextRefresh = Math.min(msTillExpiry, msTillNextRefresh);
    }

    if (msTillNextRefresh< 0) {
        const refreshed = await refreshSrcs(localGifs);
        await updateLocalGifs(refreshed);
        msTillNextRefresh = NEXT_DAY;
    }

    refreshTimer = setTimeout(refreshLocalStaleGifs, Math.max(msTillNextRefresh, 1000 * 30))
}

export async function flushRemoteGifs() {
    remoteTimer = null;

    const proto = generateProtoFromGifs(remoteGifs);

    // updateAsync does a local update that causes an extra flicker, so we call markDirty instead.
    FrecencyAC.markDirty(proto, { delaySeconds: 0, dispatch: false });
    showRemoteGifs();
}

export async function getAllLocalGifs(): Promise<GifMap | undefined> {
    const key = getKey();
    if (!key) return undefined;

    const storedGifs: GifMap | undefined = await DataStore.get(key);
    return storedGifs ?? {};
}


function generateProtoFromGifs(gifs: GifMap) {
    const proto = FrecencyAC.ProtoClass.create();
    proto.favoriteGifs = FavoriteAC.create({ gifs });

    return proto;
}

export function getFolderGifs(gifs: GifMap, folder: Folder) {
    const result: GifMap = {};
    for (const [url, gif] of Object.entries(gifs)) {
        if (gif.order >= folder.start && gif.order < folder.end)
            result[url] = gif;
    }

    return result;
}

async function dispatchGifs(gifs: GifMap) {
    const proto = generateProtoFromGifs(gifs);
    await FluxDispatcher.dispatch({
        type: "USER_SETTINGS_PROTO_UPDATE",
        local: true,
        partial: true,
        settings: {
            type: 2,
            proto: proto
        }
    });
}

export async function showRemoteGifs() {
    await dispatchGifs(remoteGifs);
}

export async function showSelectedGifs(folder: Folder) {
    const allGifs = await getAllLocalGifs();
    if (!allGifs) return;

    await dispatchGifs(getFolderGifs(allGifs, folder));
}


export async function syncLocalGifs(serverGifs: GifMap) {
    const storedGifs = await getAllLocalGifs();
    if (!storedGifs) return;

    let changed = false;
    for (const [url, value] of Object.entries(serverGifs)) {
        const cleaned = cleanGif({ ...value, url });
        if (!cleaned.url || !(cleaned.url in storedGifs)) continue;

        if (storedGifs[cleaned.url].src !== value.src) {
            storedGifs[cleaned.url].src = value.src;
            changed = true;
        }
    }

    if (changed) await updateLocalGifs(storedGifs);
}

export async function syncRemoteGifs(serverGifs?: GifMap): Promise<void> {
    const discordGifs = serverGifs ?? await getAllRemoteGifs();
    if (!discordGifs) return;

    const nextRemoteGifs: GifMap = {};
    for (const [url, value] of Object.entries(discordGifs)) {
        const cleaned = cleanGif({ ...value, url });
        if (!cleaned.url) continue;

        nextRemoteGifs[cleaned.url] = value;
    }

    remoteGifs = nextRemoteGifs;
}

export async function importGifsFromDiscord() {
    await syncRemoteGifs();
    await syncLocalGifs(remoteGifs);
    await setFolderPreviewGifs();

    return true;
}

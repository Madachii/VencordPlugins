/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { FluxDispatcher, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { DEFAULT_FOLDER_STEP, Folder } from "./folders";
import { FolderPreviewGif, GifImportOptions, GifMap } from "./types";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

const folderGifPreviews = new Map<number, FolderPreviewGif>();

// We are keeping a local copy of the remote gifs, because the local one gets modified with the new orders
// I think discord retries request on rate-limit or others, so technically this should stay in sync fully?
let remoteGifs: GifMap = {};

function setFolderPreview(idx: number, preview: FolderPreviewGif) {
    folderGifPreviews.set(idx, preview);
}

export const getRemoteGifs = () => remoteGifs;
export const setRemoteGifs = (gifs: GifMap) => { remoteGifs = gifs; };

export function addToRemoteGifs(gif: Gif) {
    if (!gif.url) return;
    const order = getNextHighestOrder(remoteGifs, () => true, 1);
    remoteGifs[gif.url] = { ...gif, order };
}

export function removeFromRemoteGifs({ url }: Gif) {
    if (url) delete remoteGifs[url];
}

export async function addRemoteGif(gif: Gif) {
    if (!gif.url) return;
    const order = getNextHighestOrder(remoteGifs, () => true, 1);
    const clean = { ...remoteGifs, [gif.url]: { ...gif, order } };
    await FrecencyAC.updateAsync("favoriteGifs", t => { t.gifs = clean; }, 0);
    remoteGifs[gif.url] = { ...gif, order };
}

export async function deleteRemoteGif(gif: Gif) {
    if (!gif.url) return;
    const clean = { ...remoteGifs };
    delete clean[gif.url];

    const proto = generateProtoFromGifs(clean);
    FrecencyAC.markDirty(proto, { delaySeconds: 0, dispatch: false });
    console.log("After mark dirty");
    delete remoteGifs[gif.url];
}

export interface Gif {
    url?: string,
    src: string,
    width: number,
    height: number,
    format: number,
    order: number,
}


export const getFolderPreviewGifs = () => folderGifPreviews;

function allLoaded(): boolean {
    try {
        FrecencyAC.ProtoClass;
    }
    catch (e) {
        new Logger("GifFolders").error("Frecency is not initialized");
        return false;
    }

    try {
        BINARY_READ_OPTIONS.readerFactory;
    }
    catch (e) {
        new Logger("GifFolders").error("BINARY_READ_OPTIONS is not initialized");
        return false;
    }

    return true;
}

function getNextHighestOrder(gifs: GifMap, filter: (g: Gif) => boolean, fallback: number): number {
    return Object.values(gifs)
        .filter(filter)
        .reduce((highest, gif) => highest > gif.order ? highest : gif.order, fallback - 1) + 1;
}

function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) {
        new Logger("GifFolders").error("Failed to key in gifStore");
        return undefined;
    }
    return `GifFolders:gif:${id}`;
}

async function updateLocalGifs(gifs: GifMap) {
    const key = getKey();
    if (!key) return;

    await DataStore.set(key, gifs);
}

// export async function startSaveTimer() {
//     await updateGifs();
//     setTimeout(startSaveTimer, 60 * 60 * 1000); // 1 hour
// }

export function cleanGif(gif: Gif) {
    if (!gif.url) return gif;

    const cleaned = { ...gif, url: gif.url.split("?")[0] };
    delete (cleaned as any).className;
    return cleaned;
}



// export async function updateGifs() {
//     const key = getKey();
//     if (!key) return;

//     const localGifs = await getAllGifs(key);
//     if (!localGifs) return;

//     const discordGifs = await getAllGifs();
//     if (!discordGifs) return;

//     const allGifs = localGifs;
//     for (const [url, value] of Object.entries(discordGifs)) {
//         if (url in allGifs) {
//             allGifs[url] = { ...value, order: allGifs[url].order };
//         }
//         else {
//             allGifs[url] = value;
//         }
//     }

//     await FrecencyAC.updateAsync(
//         "favoriteGifs",
//         data => {
//             data.gifs = allGifs;
//         },
//         0
//     );

//     await DataStore.set(key, allGifs);
// }


export async function setFolderPreviewGifs(gifs?: GifMap) {
    const allGifs = gifs || await getAllLocalGifs();
    if (!allGifs) return;

    const seen = new Set();
    for (const { format, src, order } of Object.values(allGifs)) {
        const folderIdx = Math.floor(order / DEFAULT_FOLDER_STEP);
        if (seen.has(folderIdx)) continue;

        folderGifPreviews.set(folderIdx, { format: format, src: src });
    }

    return folderGifPreviews;
}

export async function addLocalGif(folder: Folder, gif: Gif) {
    const allGifs = await getAllLocalGifs();
    if (!allGifs) return;

    // just store url in both, stop stripping
    const { url, ...rest } = gif;
    if (!url) {
        new Logger("GifFolders").error("Failed to grab the url!");
        return;
    }

    const nextOrder = getNextHighestOrder(allGifs,
        gif => gif.order >= folder.start && gif.order < folder.end,
        folder.start);

    if (nextOrder >= folder.end) return; // should be impossible to reach this

    allGifs[url] = { ...rest, order: nextOrder };
    await updateLocalGifs(allGifs);

    setFolderPreview(folder.idx, { src: rest.src, format: rest.format });

    return allGifs;
}

export async function deleteLocalGif(gif: Gif) {
    if (!gif?.url) {
        new Logger("GifFolders").error("Received a invalid gif");
        return;
    }

    const allGifs = await getAllLocalGifs();
    if (allGifs && gif.url in allGifs) {
        delete allGifs[gif.url];
        await updateLocalGifs(allGifs);
    }

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

async function getAllLocalGifs(): Promise<GifMap | undefined> {
    const key = getKey();
    if (!key) return undefined;

    const storedGifs: GifMap | undefined = await DataStore.get(key);
    if (!storedGifs) {
        new Logger("GifFolders").error("Failed to get the gifs from DB");
        return;
    }

    return storedGifs;
}

function generateProtoFromGifs(gifs: GifMap) {
    const proto = FrecencyAC.ProtoClass.create();
    if (!gifs || Object.keys(gifs).length === 0) {
        proto.favoriteGifs = { gifs: {} };
        return proto;
    }

    const currentGifsProto = FrecencyAC.getCurrentValue().favoriteGifs;

    const newGifProto = currentGifsProto !== null ?
        FavoriteAC.fromBinary(
            FavoriteAC.toBinary(currentGifsProto),
            BINARY_READ_OPTIONS,
        ) :
        FavoriteAC.create();

    newGifProto.gifs = gifs;
    proto.favoriteGifs = newGifProto;

    return proto;
}

export async function showSelectedGifs(folder?: Folder | undefined, gifs?: GifMap | null) {
    let displayGifs: GifMap;

    if (!folder) {
        displayGifs = gifs || remoteGifs;
    } else {
        const allGifs = gifs || await getAllLocalGifs();
        console.log("ALL GIFS ARE: ", allGifs);
        if (!allGifs) return;

        displayGifs = {};
        for (const [url, gif] of Object.entries(allGifs)) {
            if (gif.order >= folder.start && gif.order < folder.end)
                displayGifs[url] = gif;
        }
    }

    const proto = generateProtoFromGifs(displayGifs);
    console.log("Display gifs are: ", displayGifs);
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


async function syncGifs(storedGifs: GifMap, importNew: boolean): Promise<void> {
    const discordGifs = await getAllRemoteGifs();
    if (!discordGifs) return;

    remoteGifs = {};
    for (const gif of Object.values(discordGifs)) {
        const cleaned = cleanGif(gif);
        if (!cleaned.url) continue;

        remoteGifs[cleaned.url] = gif;

        if (cleaned.url in storedGifs) {
            storedGifs[cleaned.url] = {
                ...gif,
                order: storedGifs[cleaned.url].order,
            };
        } else if (importNew) {
            storedGifs[cleaned.url] = gif;
        }
    }

    await updateLocalGifs(storedGifs);
}

export async function importGifsFromDiscord(options: GifImportOptions = { importNew: true }) {
    if (!allLoaded()) return false;

    const storedGifs = await getAllLocalGifs() ?? {};
    await syncGifs(storedGifs, options.importNew);
    await setFolderPreviewGifs(storedGifs);

    return true;
}

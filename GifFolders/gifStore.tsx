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
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

const folderGifPreviews = new Map<number, { src: string, format: number; }>();


export interface Gif {
    url?: string,
    src: string,
    width: number,
    height: number,
    format: number,
    order: number,
}

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

export function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) {
        new Logger("GifFolders").error("Failed to key in gifStore");
        return undefined;
    }
    return `GifFolders:gif:${id}`;
}

export async function startSaveTimer() {
    await updateGifs();
    setTimeout(startSaveTimer, 60 * 60 * 1000); // 1 hour
}

export function cleanGif(gif: Gif) {
    const gifCopy = { ...gif };
    if ("className" in gifCopy) delete gifCopy.className;
    if (!gifCopy.url) return gifCopy;

    gifCopy.url = gifCopy.url.split("?")[0];
    return gifCopy;
}
export async function getAllGifs(key?: string | undefined) {
    const allGifs = key ? await getAllFavoritedGifsFromDB(key) : await getAllFavoritedGifs();
    if (!allGifs) {
        new Logger("GifFolders").error("Failed to grab all gifs");
        return undefined;
    }
    return allGifs;
}

export async function updateGifs() {
    const key = getKey();
    if (!key) return;

    const localGifs = await getAllGifs(key);
    if (!localGifs) return;

    const discordGifs = await getAllGifs();
    if (!discordGifs) return;

    const allGifs = localGifs;
    for (const [url, value] of Object.entries(discordGifs)) {
        if (url in allGifs) {
            allGifs[url] = { ...value, order: allGifs[url].order };
        }
        else {
            allGifs[url] = value;
        }
    }

    await FrecencyAC.updateAsync(
        "favoriteGifs",
        data => {
            data.gifs = allGifs;
        },
        0
    );

    await DataStore.set(key, allGifs);
}

export function getFolderPreviewGifs() {
    return folderGifPreviews;
}

export async function setFolderPreviewGifs(keyName?: string, gifs?: Record<string, Gif>) {
    const key = keyName || getKey();
    if (!key) return;

    const allGifs = gifs || await getAllGifs(key);
    if (!allGifs) return;

    const seen = new Map();
    for (const { format, src, order } of Object.values(allGifs)) {
        const folderIdx = Math.floor(order / DEFAULT_FOLDER_STEP);
        if (seen.has(folderIdx)) return;

        folderGifPreviews.set(folderIdx, { format: format, src: src });
    }

    return folderGifPreviews;
}

export async function handleGifAdd(folder: Folder, gif: Gif) {
    if (!allLoaded()) return;

    const key = getKey();
    if (!key) return;

    const allGifs = await getAllGifs(key);
    if (!allGifs) return;

    const { url, ...rest } = gif;
    if (!url) {
        new Logger("GifFolders").error("Failed to grab the url!");
        return;
    }

    const highestOrder = Object.values(allGifs)
        .filter(gif => gif.order >= folder.start && gif.order < folder.end)
        .reduce((highest, gif) => highest > gif.order ? highest : gif.order, folder.start - 1);

    if (highestOrder + 1 >= folder.end) return; //  should be impossible to reach this

    allGifs[url] = { ...rest, order: highestOrder + 1 };
    DataStore.set(key, allGifs);

    folderGifPreviews.set(folder.idx, { src: rest.src, format: rest.format });

    return allGifs;
}

export async function handleGifDelete(gif: Gif, lastVisited: Folder | null = null) {
    if (gif?.url === undefined) {
        new Logger("GifFolders").error("Received a invalid gif");
        return;
    }

    if (!allLoaded()) return;

    const key = getKey();
    if (!key) return;

    const allGifs = await getAllGifs(key);
    if (!allGifs) return;

    if (!(gif.url in allGifs)) {
        new Logger("GifFolders").error("Failed to find the gif, won't delete!");
        return;
    }

    delete allGifs[gif.url];
    DataStore.set(key, allGifs); // continue modifying this
    return allGifs;

}

// Need to use the RestApi because FrecencyAC.getCurrentValue()
// return the local array of gifs (affected by FluxDispatcher)
export async function getAllFavoritedGifs(): Promise<Record<string, Gif> | undefined> {
    if (!allLoaded()) undefined;

    const { ok, status, body } = await RestAPI.get({
        url: "/users/@me/settings-proto/2"
    });

    if (!ok || status !== 200 || !body?.settings)
        return undefined;

    const bytes = Uint8Array.from(atob(body.settings), c => c.charCodeAt(0));
    const end = FrecencyAC.ProtoClass.fromBinary(
        bytes,
        BINARY_READ_OPTIONS
    );

    if (!end.favoriteGifs || !end.favoriteGifs.gifs)
        return undefined;

    return end.favoriteGifs.gifs;
}

async function getAllFavoritedGifsFromDB(key: string): Promise<Record<string, Gif> | undefined> {
    const storedGifs: Record<string, Gif> | undefined = await DataStore.get(key);
    if (!storedGifs) {
        console.log("Failed to get the gifs from DB");
        return;
    }

    return storedGifs;
}

function generateProtoFromGifs(gifs: Record<string, Gif>) {
    if (!allLoaded()) return;

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

export async function showSelectedGifs(folder?: Folder | undefined, gifs?: Record<string, Gif> | null) {
    const key = getKey();
    if (!key) return;

    const allGifs = gifs || await getAllGifs(key);
    if (!allGifs) return;

    let filteredGifs;
    if (!folder)
        filteredGifs = allGifs;
    else {
        filteredGifs = Object.fromEntries(
            Object.entries(allGifs)
                .filter(([, { order }]) => order >= folder.start && order < folder.end)
                .map(([url, data]) => [url, { ...data }])
        );
    }

    const proto = generateProtoFromGifs(filteredGifs);
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
// So we are not going to modify the users gif, instead we are going to add everything they have
// and then fully use the Vencord db module
export async function initializeGifs() {
    console.log("DATA STORE: ", DataStore);
    if (!allLoaded()) return false;

    const key = getKey();
    if (!key) return false;

    const allGifs = await getAllFavoritedGifs();
    if (!allGifs) {
        new Logger("GifFolders").error("Failed to grab all gifs");
        return false;
    }

    const storedGifs: Record<string, Gif> = await DataStore.get(key) ?? {};
    for (const [url, value] of Object.entries(allGifs)) {
        if (url in storedGifs) {
            storedGifs[url].src = value.src;
        }
        else {
            storedGifs[url] = value;
        }
    }

    await DataStore.set(key, storedGifs);
    await setFolderPreviewGifs(key, storedGifs);

    return true;
}

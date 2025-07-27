/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { FluxDispatcher, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { Folder } from "./folders";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

let LAST_SAVE_TIME = 0;
const GIF_TO_BE_UPDATED: { save: Record<string, Gif>; delete: Set<string>; } = { save: {}, delete: new Set() };
let ALL_GIFS: Record<string, Gif>;

export interface Gif {
    url?: string,
    className: string,
    src: string,
    width: number,
    height: number,
    format: number,
    order: number,
}

async function updateGifs(save?: Record<string, Gif>, del?: string) {
    const timePassed = Date.now() - LAST_SAVE_TIME;

    console.log("TIME PASSED: ", timePassed);
    if (timePassed >= 10000) {
        const key = getKey();
        if (!key) return;

        const allGifs = await DataStore.get(key);
        if (!allGifs) return;

        await FrecencyAC.updateAsync(
            "favoriteGifs",
            data => {
                data.gifs = { ...allGifs };
            },
            0
        );
        console.log("Updated gifs!");

        LAST_SAVE_TIME = Date.now();
    }
    else {
        const waitTime = 10000 - timePassed + 100; // im not sure if the extra time is needed, but i dont want to run into timing issues
        setTimeout(() => updateGifs(), waitTime);
    }
}

async function queueGifUpdate(key?: string, allGifs?: Record<string, Gif>) {
    if (!allGifs) {
        console.log("Didn't get the full gif list");
        return;
    }

    if (Object.keys(GIF_TO_BE_UPDATED.save).length === 0 && GIF_TO_BE_UPDATED.delete.size === 0) {
        console.log("No more gifs to change!");
        return;
    }

    for (const [url, gif] of Object.entries(GIF_TO_BE_UPDATED.save ?? {})) {
        allGifs[url] = gif;
        GIF_TO_BE_UPDATED.save[url] = gif;
    }

    for (const url of GIF_TO_BE_UPDATED.delete ?? new Set()) {
        delete allGifs[url];
        GIF_TO_BE_UPDATED.delete.add(url);
    }

    console.log("queue running!, updating with the follwing: ", GIF_TO_BE_UPDATED);
    await DataStore.set(key, allGifs);
    await updateGifs(allGifs);
    return allGifs;
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

function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) {
        new Logger("GifFolders").error("Failed to key in gifStore");
        return undefined;
    }
    return `GifFolders:gif:${id}`;
}



export async function getGif(url: string | undefined) {
    const key = getKey();
    if (!key || !url) return undefined;

    const gifs = await DataStore.get(key);
    return gifs[url];
}
async function getAllGifs(key) {
    const allGifs: Record<string, Gif> | undefined = await getAllFavoritedGifsFromDB(key);
    if (!allGifs) {
        new Logger("GifFolders").error("Failed to grab all gifs");
        return undefined;
    }
    return allGifs;
}

// change this to get the last free open index instead
// would it work to Set the values so the editing person can change folders easily?
export async function handleGifAdd(folder: Folder, gif: Gif, lastVisited: Folder | null = null) { // using incrementing index for now, change later for unique ids or something
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

    const newGif = { ...rest, order: highestOrder + 1 };
    return updateGifs({ save: { [url]: newGif } });
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

    return updateGifs();
}

// Need to use the RestApi because FrecencyAC.getCurrentValue()
// return the local array of gifs (affected by FluxDispatcher)
async function getAllFavoritedGifs(): Promise<Record<string, Gif> | null> {
    if (!allLoaded()) null;
    const { ok, status, body } = await RestAPI.get({
        url: "/users/@me/settings-proto/2"
    });

    if (!ok || status !== 200 || !body?.settings)
        return null;

    const bytes = Uint8Array.from(atob(body.settings), c => c.charCodeAt(0));
    const end = FrecencyAC.ProtoClass.fromBinary(
        bytes,
        BINARY_READ_OPTIONS
    );

    if (!end.favoriteGifs || !end.favoriteGifs.gifs)
        return null;

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

export async function showSelectedGifs(folder?: Folder | null, gifs?: Record<string, Gif> | null) {
    const key = getKey();
    if (!key) return;

    const allGifs = await getAllGifs(key);
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
    if (!allLoaded()) return false;

    const key = getKey();
    if (!key) return false;

    const allGifs = await getAllFavoritedGifs();
    if (!allGifs) {
        new Logger("GifFolders").error("Failed to grab all gifs");
        return false;
    }

    const storedGifs: Record<string, Gif> | undefined = await DataStore.get(key) ?? {};
    for (const [url, value] of Object.entries(allGifs)) {
        storedGifs[url] = value;
    }

    await DataStore.set(key, storedGifs);
    return true;
}

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


export interface Gif {
    url?: string,
    className: string,
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

function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) {
        new Logger("GifFolders").error("Failed to key in gifStore");
        return undefined;
    }
    return `GifFolders:gif:${id}`;
}

// change this to get the last free open index instead
// would it work to Set the values so the editing person can change folders easily?
export async function handleGifAdd(folder: Folder, gif: Gif, lastVisited: Folder | null = null) { // using incrementing index for now, change later for unique ids or something
    if (!allLoaded()) return;

    const key = getKey();
    if (!key) return;

    const allGifs: Record<string, Gif> | undefined = await getAllFavoritedGifsFromDB(key);
    if (!allGifs) {
        new Logger("GifFolders").error("Failed to grab all gifs!");
        return;
    }

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
    await DataStore.set(key, allGifs);
}

export async function handleGifDelete(gif: Gif, lastVisited: Folder | null = null) {
    if (gif?.url === undefined) {
        new Logger("GifFolders").error("Received a invalid gif");
        return;
    }

    if (!allLoaded()) return;

    const key = getKey();
    if (!key) return;

    const allGifs: Record<string, Gif> | undefined = await getAllFavoritedGifsFromDB(key);
    if (!allGifs) {
        new Logger("GifFolders").error("Failed to grab all gifs!");
        return;
    }

    if (!(gif.url in allGifs)) {
        new Logger("GifFolders").error("Failed to find the gif, won't delete!");
        return;
    }

    delete allGifs[gif.url];
    DataStore.set(key, allGifs); // continue modifying this
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

export async function showSelectedGifs(folder?: Folder | null) {
    const key = getKey();
    if (!key) return;

    const allGifs: Record<string, Gif> | undefined = await getAllFavoritedGifsFromDB(key);
    if (!allGifs) {
        console.log("Failed to get all gifs!");
        return;
    }

    let filteredGifs;
    if (!folder)
        filteredGifs = allGifs;
    else {
        filteredGifs = Object.fromEntries(
            Object.entries(allGifs as Record<string, Gif>)
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

    const allGifs: Record<string, Gif> | null = await getAllFavoritedGifs();
    if (!allGifs || Object.keys(allGifs).length === 0) {
        console.log("Failed to get all gifs or you don't have any gifs");
        return true;
    }

    const storedGifs: Record<string, Gif> | undefined = await DataStore.get(key) ?? {};
    if (Object.keys(storedGifs).length === 0) {
        for (const [url, value] of Object.entries(allGifs)) {
            storedGifs[url] = value;
        }
    }

    await DataStore.set(key, storedGifs);
    return true;
}

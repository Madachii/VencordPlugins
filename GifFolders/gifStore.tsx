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
import { FolderPreviewGif, GifImportOptions, GifMap, RawGif } from "./types";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

const folderGifPreviews = new Map<number, FolderPreviewGif>();

export const getFolderPreviewGifs = () => folderGifPreviews;
function setFolderPreview(idx: number, preview: FolderPreviewGif) {
    folderGifPreviews.set(idx, preview);
}

// We are keeping a local copy of the remote gifs, because the local one gets modified with the new orders
// I think discord retries request on rate-limit or others, so technically this should stay in sync fully?
let remoteGifs: GifMap = {};

export const getRemoteGifs = () => remoteGifs;
export const setRemoteGifs = (gifs: GifMap) => { remoteGifs = gifs; };


export async function addRemoteGif(gif: RawGif) {
    const { url, ...rest } = gif;

    const order = Object.values(remoteGifs).reduce((h, g) => Math.max(h, g.order), 0) + 1;
    remoteGifs[url] = { ...rest, order };

    await patchRemoteGifs(remoteGifs);
}

export async function deleteRemoteGif(gif: RawGif) {
    delete remoteGifs[gif.url];
    await patchRemoteGifs(remoteGifs);

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

export function cleanGif(gif: RawGif) {
    const cleaned = { ...gif, url: gif.url.split("?")[0] };
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

export async function addLocalGif(folder: Folder, rawGif: RawGif) {
    const allGifs = await getAllLocalGifs();
    if (!allGifs) return;

    const { url, ...rest } = rawGif;

    const nextOrder = getNextOrderForGif(folder, allGifs);

    allGifs[url] = { ...rest, order: nextOrder };
    await updateLocalGifs(allGifs);

    setFolderPreview(folder.idx, { src: rest.src, format: rest.format });

    return allGifs;
}

export async function deleteLocalGif(rawGif: RawGif) {
    const allGifs = await getAllLocalGifs();
    if (allGifs && rawGif.url in allGifs) {
        delete allGifs[rawGif.url];
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

export async function patchRemoteGifs(gifs: GifMap) {
    const proto = generateProtoFromGifs(gifs);

    // updateAsync does a local update that causes an extra flicker, so we call markDirty instead.
    FrecencyAC.markDirty(proto, { delaySeconds: 0, dispatch: false });
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
    proto.favoriteGifs = FavoriteAC.create({ gifs });
    return proto;
}

function getFolderGifs(gifs: GifMap, folder: Folder) {
    const result: GifMap = {};
    for (const [url, gif] of Object.entries(gifs)) {
        if (gif.order >= folder.start && gif.order < folder.end)
            result[url] = gif;
    }

    return result;
}

export async function showSelectedGifs(folder?: Folder | undefined, gifs?: GifMap | null) {
    let displayGifs: GifMap;

    if (!folder) {
        displayGifs = gifs || remoteGifs;
        console.log("Gifs are: ", gifs, " rmeote gifs are: ", remoteGifs);
    } else {
        const allGifs = gifs || await getAllLocalGifs();
        console.log("ALL GIFS ARE: ", allGifs);
        if (!allGifs) return;

        displayGifs = getFolderGifs(allGifs, folder)
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

    console.log("[syncGifs] discordGifs: ", discordGifs);

    remoteGifs = {};
    for (const [url, gif] of Object.entries(discordGifs)) {
        const cleaned = cleanGif({ ...gif, url });
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

    console.log("[syncGifs] storedGifs are: ", storedGifs);
    console.log("[syncGifs] remote gifs are: ", remoteGifs);
    await updateLocalGifs(storedGifs);
}

export async function importGifsFromDiscord(options: GifImportOptions = { importNew: true }) {
    const storedGifs = await getAllLocalGifs() ?? {};
    await syncGifs(storedGifs, options.importNew);
    await setFolderPreviewGifs(storedGifs);

    return true;
}

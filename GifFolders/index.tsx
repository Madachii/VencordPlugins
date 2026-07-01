/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { FluxDispatcher, React } from "@webpack/common";

import { AddFolder, DeleteFolder, Folder, getFolders, initializeFolder, RenameFolder, SwapFolder } from "./folders";
import { cleanGif, getFolderPreviewGifs, importGifsFromDiscord, setRemoteGifs, showSelectedGifs } from "./gifStore";
import { openAddGifMenu } from "./menus";
import { TrendingCategory } from "./types";
import { grabGifProp } from "./utils";

let GIF_PICKER_CALLBACK;
let USER_SETTINGS_PROTO_UPDATE_CALLBACK;
let LAST_VISITED_FOLDER: Folder | undefined = undefined;
let IS_READY = false;

export default definePlugin({
    name: "GifFolders",
    description: "Allows you to organize your gifs into folders. Start by running (/AddFolder)",
    authors: [
        {
            name: "Madachi",
            id: 670129843109672n,
        },
    ],
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "AddFolder",
            description: "Add a new gif folder!",
            options: [
                {
                    name: "folder_name",
                    description: "Give the folder a name!",
                    type: ApplicationCommandOptionType.STRING,
                },
            ],
            execute: async (opts, cmd) => AddFolder(opts, cmd),
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "RenameFolder",
            description: "Rename a already existing folder!",
            options: [
                {
                    name: "old_name",
                    description: "Name of the already existing folder",
                    type: ApplicationCommandOptionType.STRING,
                },
                {
                    name: "new_name",
                    description: "The new name to change it into!",
                    type: ApplicationCommandOptionType.STRING,
                },
            ],
            execute: async (opts, cmd) => RenameFolder(opts, cmd),
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "SwapFolder",
            description: "Swap the position of two folders!",
            options: [
                {
                    name: "first",
                    description: "First folder name",
                    type: ApplicationCommandOptionType.STRING,
                },
                {
                    name: "second",
                    description: "Second folder name",
                    type: ApplicationCommandOptionType.STRING,
                },
            ],
            execute: async (opts, cmd) => SwapFolder(opts, cmd),
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "DeleteFolder",
            description: "Delete a existing folder!",
            options: [
                {
                    name: "folder_name",
                    description: "Write the name of the folder you want to delete",
                    type: ApplicationCommandOptionType.STRING,
                },
            ],
            execute: async (opts, cmd) => DeleteFolder(opts, cmd),
        },
    ],

    async start() {
        IS_READY = (await initializeFolder()) && (await importGifsFromDiscord({ importNew: false }));
        if (!IS_READY) return;

        // await startSaveTimer();
        // subscribing to this event because it's the only event that i know which runs after the gif menu closes
        // also happens when the user clears their gif search but it doesnt affect it
        GIF_PICKER_CALLBACK = ({ query }) => {
            if (!query) showSelectedGifs();
        };
        FluxDispatcher.subscribe("GIF_PICKER_QUERY", GIF_PICKER_CALLBACK);

        // syincing between clients, also just in case.
        USER_SETTINGS_PROTO_UPDATE_CALLBACK = (event: any) => {
            if (event.local || event.settings?.type !== 2) return;

            const gifs = event.settings?.proto?.favoriteGifs?.gifs;
            if (!gifs) return;

            setRemoteGifs(gifs);
        };
        FluxDispatcher.subscribe("USER_SETTINGS_PROTO_UPDATE", USER_SETTINGS_PROTO_UPDATE_CALLBACK);
    },

    stop() {
        if (GIF_PICKER_CALLBACK) {
            FluxDispatcher.unsubscribe("GIF_PICKER_QUERY", GIF_PICKER_CALLBACK);
            GIF_PICKER_CALLBACK = null;
        }
        if (USER_SETTINGS_PROTO_UPDATE_CALLBACK) {
            FluxDispatcher.unsubscribe("USER_SETTINGS_PROTO_UPDATE", USER_SETTINGS_PROTO_UPDATE_CALLBACK);
            USER_SETTINGS_PROTO_UPDATE_CALLBACK = null;
        }
    },

    patches: [
        {
            find: '["5/NS74"]',
            replacement: {
                match: /onClick:(\i)/,
                replace: "onClick:(e)=>($self.saveGif(e, $1))",
            },
        },
        {
            find: "GIF_PICKER_TRENDING_SEARCH_TERMS_SUCCESS",
            replacement: {
                match: /getTrendingCategories\(\){return (\i)}/,
                replace: "getTrendingCategories(){return $self.getTrendingCategories($1)}",
            },
        },
        {
            find: "handleSelectItem",
            replacement: {
                match: /handleSelectItem=\((\i),((\i))\)=>{/,
                replace: "$&$self.handleSelectItem($1,$2);",
            },
        },
    ],

    async saveGif(e: React.UIEvent, original) {
        if (!IS_READY) return original(e);

        const gif = grabGifProp(e);
        if (!gif?.url) return original(e)

        const cleanedGif = cleanGif(gif);
        const result = await openAddGifMenu(e, cleanedGif, getFolders());

        console.log("D");

        // console.log("LAST VISITED FOLDER: ", LAST_VISITED_FOLDER, " AND RESULT IS: ", result?.gifs)
        // await showSelectedGifs(LAST_VISITED_FOLDER, result?.gifs);
    },

    // TODO: make it an option if user wants to keep the default trending categories
    getTrendingCategories(trendingArray) {
        if (!IS_READY) return trendingArray;

        const categories: Array<TrendingCategory> = [];

        const folders = getFolders();
        if (Object.keys(folders).length === 0) return trendingArray; // Should probably display some text mentioning how to add folder

        const folderPreviews = getFolderPreviewGifs();
        for (const { idx, name } of Object.values(folders)) {
            const gif = folderPreviews.get(idx);
            categories.push({
                name: name,
                src: gif?.src ?? "",
                type: "Favorites",
                format: gif?.format ?? 1,
            });
        }

        return categories;
    },

    async handleSelectItem(type: string, name: string) {
        if (!IS_READY) return;

        console.log("type: ", type, " name: ", name);
        const folders = getFolders();
        const visited = folders[name];

        LAST_VISITED_FOLDER = visited;
        showSelectedGifs(visited);
    },
});

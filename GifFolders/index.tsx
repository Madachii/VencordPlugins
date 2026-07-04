/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { AddFolder, DeleteFolder, Folder, getFolders, initializeFolder, RenameFolder, SwapFolder } from "./folders";
import { cleanGif, getFolderPreviewGifs, importGifsFromDiscord, refreshLocalStaleGifs, showRemoteGifs, showSelectedGifs, syncLocalGifs, syncRemoteGifs } from "./gifStore";
import { openGifMenu } from "./menus";
import { TrendingCategory } from "./types";
import { grabGifProp } from "./utils";

let LAST_VISITED_FOLDER: Folder | undefined = undefined;
let IS_READY = false;

const settings = definePluginSettings({
    overwriteTrending: {
        type: OptionType.BOOLEAN,
        description: "Disable Discord's trending GIFs",
        default: true,
        restartNeeded: false
    }
})

export default definePlugin({
    name: "GifFolders",
    description: "Allows you to organize your gifs into folders. Start by running (/AddFolder)",
    settings,
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


    flux: {
        // subscribing to this event because it's the only event that i know which runs after the gif menu closes
        // also happens when the user clears their gif search but it doesnt affect it
        GIF_PICKER_QUERY({ query }) {
            if (!IS_READY) return;
            if (!query) showRemoteGifs();
        },


        // this still causes a small flicker, alternative would be to intercept it but
        // i don't think it's worth doing
        USER_SETTINGS_PROTO_UPDATE(event: any) {
            if (!IS_READY) return;
            if (event.local || event.settings?.type !== 2) return;

            const gifs = event.settings?.proto?.favoriteGifs?.gifs;
            if (!gifs) return;

            syncRemoteGifs(gifs);
            syncLocalGifs(gifs);
            if (LAST_VISITED_FOLDER) showSelectedGifs(LAST_VISITED_FOLDER);
        },
    },

    async start() {
        IS_READY = (await initializeFolder()) && (await importGifsFromDiscord());
        refreshLocalStaleGifs()
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
        if (!gif) return original(e);

        const cleanedGif = cleanGif(gif);
        const result = await openGifMenu(e, cleanedGif, getFolders());

        if (LAST_VISITED_FOLDER) await showSelectedGifs(LAST_VISITED_FOLDER);
        else showRemoteGifs();
    },

    // TODO: make it an option if user wants to keep the default trending categories
    getTrendingCategories(trendingArray: Array<TrendingCategory>) {
        if (!IS_READY) return trendingArray;
        if (trendingArray.length === 0) return trendingArray; // populating this before discord does breaks it


        const folders = getFolders();
        if (Object.keys(folders).length === 0) return trendingArray; // Should probably display some text mentioning how to add folder

        const categories = getFolderPreviewGifs(folders);
        if (!settings.store.overwriteTrending) categories.push(...trendingArray);

        return categories
    },

    async handleSelectItem(type: string, name: string) {
        if (!IS_READY) return;

        const folders = getFolders();
        const visited = folders[name];

        LAST_VISITED_FOLDER = visited;
        if (visited) showSelectedGifs(visited);
        else showRemoteGifs();
    },
});

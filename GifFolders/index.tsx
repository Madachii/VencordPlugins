/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import { DataStore } from "@api/index";
import definePlugin from "@utils/types";
import { FluxDispatcher, React } from "@webpack/common";

import { AddFolder, DeleteFolder, Folder, getFolders, initializeFolder, RenameFolder } from "./folders";
import { getFolderPreviewGifs, initializeGifs, showSelectedGifs, startSaveTimer } from "./gifStore";
import { openAddGifMenu } from "./menus";
import { grabGifProp } from "./utils";


let GIF_PICKER_CALLBACK;
let LAST_VISITED_FOLDER: Folder | undefined = undefined;
let IS_READY = true;

export default definePlugin({
    name: "GifFolders",
    description: "Let's create and organize 'folders' for gifs! Start by running (/AddFolder, /DeleteFolder)",
    authors: [{
        name: "Madachi",
        id: 670129843109672n
    }],
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "AddFolder",
            description: "Add a new gif folder!",
            options: [
                {
                    name: "folder_name",
                    description: "Give the folder a name!",
                    type: ApplicationCommandOptionType.STRING
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
                    type: ApplicationCommandOptionType.STRING
                },
                {
                    name: "new_name",
                    description: "The new name to change it into!",
                    type: ApplicationCommandOptionType.STRING
                }
            ],
            execute: async (opts, cmd) => RenameFolder(opts, cmd),
        },
        // {
        //     inputType: ApplicationCommandInputType.BUILT_IN,
        //     name: "SwapFolder",
        //     description: "Change the position of one folder with another!",
        //     options: [
        //         {
        //             name: "old_name",
        //             description: "Name of the already existing folder",
        //             type: ApplicationCommandOptionType.STRING
        //         },
        //         {
        //             name: "new_name",
        //             description: "The new name to change it into!",
        //             type: ApplicationCommandOptionType.STRING
        //         }
        //     ],
        //     execute: async (opts, cmd) => SwapFolder(opts, cmd),
        // },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "DeleteFolder",
            description: "Delete a existing folder!",
            options: [
                {
                    name: "folder_name",
                    description: "Write the name of the folder you want to delete",
                    type: ApplicationCommandOptionType.STRING
                },
            ],
            execute: async (opts, cmd) => DeleteFolder(opts, cmd),
        },
    ],

    async start() {
        console.log(DataStore);
        IS_READY = await initializeFolder() && await initializeGifs();
        if (!IS_READY) return;

        await startSaveTimer();
        // subscribing to this event because it's the only event that i know which runs after the gif menu closes
        // also happens when the user clears their gif search but it doesnt affect it
        GIF_PICKER_CALLBACK = ({ query }) => {
            if (!query) showSelectedGifs();
        };
        FluxDispatcher.subscribe("GIF_PICKER_QUERY", ({ query }) => { if (!query) showSelectedGifs(); });


    },

    stop() {
        if (GIF_PICKER_CALLBACK) {
            FluxDispatcher.unsubscribe("GIF_PICKER_QUERY", GIF_PICKER_CALLBACK);
            GIF_PICKER_CALLBACK = null;
        }
    },

    patches: [
        {
            find: "gifFavoriteButton,{",
            replacement: {
                match: /onClick:(\i)/,
                replace: "onClick:(e)=>($self.saveGif(e, $1))"
            }
        },
        {
            find: "FIXED_HEIGHT_SMALL_MP4",
            replacement: {
                match: /getTrendingCategories\(\){return (\i)}/,
                replace: "getTrendingCategories(){return $self.getTrendingCategories($1)}"
            }
        },
        {
            find: "\"handleSelectItem\"",
            replacement: {
                match: /"handleSelectItem",\((\i),(\i)\)=>{/,
                replace: "$&$self.handleSelectItem($1,$2);"
            }
        }
    ],

    // restore default if folder missing etc
    async saveGif(e: React.UIEvent, original) {
        if (!IS_READY) return original(e);

        const gif = grabGifProp(e);
        if (!gif) return original(e);

        e.preventDefault();
        e.stopPropagation();

        const result = await openAddGifMenu(e, gif, getFolders());
        await showSelectedGifs(LAST_VISITED_FOLDER, result?.gifs);
    },

    getTrendingCategories(trendingArray) {
        const categories: Array<{ name: string, src: string, type: string, format: number; }> = [];

        const folders = getFolders();
        if (folders.size === 0) return trendingArray;

        const folderPreviews = getFolderPreviewGifs();
        for (const { idx, name } of folders.values()) {
            const gif = folderPreviews.get(idx);
            categories.push({ name: name, src: gif?.src ?? "", type: "Favorites", format: gif?.format ?? 1 });
        }

        return categories;
    },

    async handleSelectItem(type: string, name: string) {
        const folders = getFolders();
        const visited = folders.get(name);
        LAST_VISITED_FOLDER = visited;
        if (type === "Favorites" && name === "Favorites")
            await showSelectedGifs();
        else
            await showSelectedGifs(visited);
    }
}
);

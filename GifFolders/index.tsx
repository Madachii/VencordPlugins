/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import definePlugin from "@utils/types";
import { FluxDispatcher, React } from "@webpack/common";

import { AddFolder, DeleteFolder, Folder, getFolders, initializeFolder } from "./folders";
import { initializeGifs, showSelectedGifs } from "./gifStore";
import { openAddGifMenu, openGifMenuAsync } from "./menus";
import { grabGifProp } from "./utils";



let GIF_PICKER_CALLBACK;
let LAST_VISITED_FOLDER: Folder | null = null;
let IS_READY = true;

export default definePlugin({
    name: "Madachi",
    description: "Makes it possible to organize gifs in folders, currently not working",
    authors: [{
        name: "You!",
        id: 0n
    }],
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "AddFolder",
            description: "Add a new gif folder!",
            options: [
                {
                    name: "add_folder",
                    description: "Give the folder a name!",
                    type: ApplicationCommandOptionType.STRING
                },
            ],
            execute: async (opts, cmd) => AddFolder(opts, cmd),
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "DeleteFolder",
            description: "Delete a existing folder!",
            options: [
                {
                    name: "delete_folder",
                    description: "Write the name of the folder you want to delete", // maybe could list the map?
                    type: ApplicationCommandOptionType.STRING
                },
            ],
            execute: async (opts, cmd) => DeleteFolder(opts, cmd),
        },
    ],

    async start() {
        IS_READY = await initializeFolder() && await initializeGifs();
        if (!IS_READY) return;

        // subscribing to this event because it's the only event that i know which runs after the gif menu closes
        // also happens when the user clears their gif search but it doesnt affect it
        GIF_PICKER_CALLBACK = ({ query }) => {
            if (!query) showSelectedGifs(null);
        };
        FluxDispatcher.subscribe("GIF_PICKER_QUERY", ({ query }) => { if (!query) showSelectedGifs(null); });
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
            find: "\"handleCanPlay\",",
            replacement: {
                match: /\(\)=>{let[^)]*./, // change this to reduce chance of corruption
                replace: "(event)=>{$self.onGifSelect(event, this.props);"
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

        await openAddGifMenu(e, gif, getFolders(), LAST_VISITED_FOLDER); // could optimize by passing the all gif object in resolve
        await showSelectedGifs(LAST_VISITED_FOLDER);
    },

    async onGifSelect(e: React.UIEvent, props) {
        const { type, name } = props.item;

        const shouldHandle = IS_READY && type === "Favorites" && name === "Favorites";
        if (shouldHandle) {
            e.preventDefault();
            e.stopPropagation();
            LAST_VISITED_FOLDER = await openGifMenuAsync(e, getFolders());
        }

        props.onClick?.(props.item, props.index); // original function
    }
}
);


// add insertion checks

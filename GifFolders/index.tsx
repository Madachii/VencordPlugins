/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { ContextMenuApi, FluxDispatcher, Menu, React, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { DEFAULT_FOLDER_STEP, Folder, Gif, GifMap } from "./classes";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

const FOLDERS: Map<string, Folder> = new Map<string, Folder>();

let IS_READY = true;


function grabGifProp(e: React.UIEvent): Gif | null {
    const node = e.currentTarget;
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber$"));
    if (!key || !(key in node)) return null;

    let fiber = node[key];
    while (fiber) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props?.gif || (props?.src && props?.url)) {
            return props;
        }
        fiber = fiber.return;
    }
    return null;
}

// change this to get the last free open index instead
// would it work to Set the values so the editing person can change folders easily?
async function handleGifAdd(folder: Folder, gif: Gif) { // using incrementing index for now, change later for unique ids or something
    const allGifs: GifMap | null = await getAllFavoritedGifs();
    if (!allGifs) {
        console.log("Failed to grab all gifs!");
        return;
    }

    const { url, ...rest } = gif;
    if (!url) {
        console.log("Failed to find the url in the gif...");
        return;
    }

    await FrecencyAC.updateAsync(
        "favoriteGifs",
        proto => {
            const highestOrder = Object.values(allGifs)
                .filter(gif => gif.order >= folder.start && gif.order < folder.end)
                .reduce((highest, gif) => highest > gif.order ? highest : gif.order, folder.start - 1);

            proto.gifs = { ...allGifs };
            proto.gifs[url] = { ...rest, order: highestOrder + 1 };
            proto.hideTooltip = false;
        },
        0 // I'm not sure if this delay is needed
    );
}

// add length checks
async function handleGifDelete(gif: Gif) {
    if (gif?.url === undefined) {
        console.log("Received invalid gif");
        return;
    }

    const allGifs: GifMap | null = await getAllFavoritedGifs();
    if (!allGifs) {
        console.log("Failed to grab all gifs!");
        return;
    }

    if (!(gif.url in allGifs)) {
        console.log("Gif not found in the whole gif object!");
        return;
    }

    await FrecencyAC.updateAsync(
        "favoriteGifs",
        proto => {
            proto.gifs = { ...allGifs };
            delete proto.gifs[gif.url as string];
            proto.hideTooltip = false; // im not even sure if this is neeed
        },
        0
    );
}

function openAddGifMenu(e: React.UIEvent, gif) {
    const folderList = Array.from(FOLDERS.values()); // not sure why, but using forEach makes the element disappear on hover

    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu
            navId="madachi-gif-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Madachi Gif Menu"
        >
            {folderList.map(folder => (
                <Menu.MenuItem
                    key={`folder-${folder.name}`}
                    id={`favorite-folder-${folder.name}`}
                    label={`Add to ${folder.name}`}
                    color="brand"
                    action={() => handleGifAdd(folder, gif)}
                />
            ))}
            <Menu.MenuItem
                id={"delete-favorite"}
                label={"Delete"}
                color="danger"
                action={() => handleGifDelete(gif)}
            />
        </Menu.Menu>
    ));
}

function openGifMenuAsync(e: React.UIEvent): Promise<void> {
    const folderList = Array.from(FOLDERS.values()); // not sure why, but using forEach makes the element disappear on hover

    return new Promise<void>(resolve => {
        ContextMenuApi.openContextMenu(e, () => (
            <Menu.Menu
                navId="madachi-gif-menu"
                aria-label="Madachi Gif Menu"
                onClose={async () => {
                    await FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });
                    resolve();
                }}
            >
                {folderList.map(folder => (
                    <Menu.MenuItem
                        key={`open-folder-${folder.name}`}
                        id={`open-folder-${folder.name}`}
                        label={`Open ${folder.name}`}
                        color="brand"
                        action={async () => {
                            await showSelectedGifs(folder);
                            resolve();
                        }}
                    />
                ))}
            </Menu.Menu>
        )
        );
    });
}

function generateProtoFromGifs(gifs) {
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
async function showSelectedGifs(folder: Folder) {
    if (!folder) {
        console.log("Got a undefined folder!");
        return;
    }

    const allGifs: GifMap | null = await getAllFavoritedGifs();
    if (!allGifs) {
        console.log("Failed to get all gifs!");
        return;
    }

    const filteredGifs = Object.fromEntries(
        Object.entries(allGifs as GifMap)
            .filter(([, { order }]) => order >= folder.start && order < folder.end)
            .map(([url, data]) => [url, { ...data }])
    );

    const proto = generateProtoFromGifs(filteredGifs);

    console.log(" OUR NEW PROTO TO SHOW: ", proto);
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

// Need to use the RestApi because FrecencyAC.getCurrentValue()
// return the local array of gifs (affected by FluxDispatcher)
async function getAllFavoritedGifs(): Promise<GifMap | null> {
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

async function AddFolder(opts, cmd) {
    if (!opts || !cmd || opts.length < 1) return;

    const { name, value } = opts[0];
    if (name !== "add_folder") return;

    if (FOLDERS.get(value)) {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `You already have a folder called ${value}!: ` });
        return;
    }

    const folder = {
        idx: FOLDERS.size,
        name: value,
        start: FOLDERS.size * DEFAULT_FOLDER_STEP + 1,
        end: FOLDERS.size * DEFAULT_FOLDER_STEP + DEFAULT_FOLDER_STEP
    };

    FOLDERS.set(value, folder);
    DataStore.set(`GifFolders:${UserStore.getCurrentUser().id}`, Object.fromEntries(FOLDERS));

    cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Succesfully created a new folder called: ${value}! ` });
}

async function DeleteFolder(opts, cmd) {
    if (opts.length < 1) return;

    const { name, value } = opts[0];
    if (name !== "delete_folder") return;
    if (value === "Default") {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: "Cannot delete the Default folder!" });
        return;
    }

    if (FOLDERS.delete(value)) {
        DataStore.set(`GifFolders:${UserStore.getCurrentUser().id}`, Object.fromEntries(FOLDERS));
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Succesfully deleted the folder: ${value}! ` });
    }
    else {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Failed to delete folder ${value}, are you sure it exists?` });
    }
}

async function initializeFolder() {
    const key = `GifFolders:${UserStore.getCurrentUser().id}`;
    const storedFolders = await DataStore.get(key);

    if (!storedFolders || !storedFolders.Default || Object.keys(storedFolders).length === 0) {
        await AddFolder([{ name: "add_folder", value: "Default" }], null);
        return;
    }

    const defaultFolder = storedFolders.Default as Folder;
    FOLDERS.set("Default", defaultFolder);
    for (const [key, value] of Object.entries(storedFolders)) {
        if (key !== "Default") FOLDERS.set(key, value);
    }


}
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

    // add start check to make sure Frequencecy Action Center is there and the others, else no point
    async start() {
        if (!FrecencyAC || !FavoriteAC || !BINARY_READ_OPTIONS || UserStore) {
            IS_READY = false;
            return;
        }

        await initializeFolder();
        if (!FOLDERS || FOLDERS.size === 0)
            IS_READY = false;
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

        openAddGifMenu(e, gif);
    },

    async onGifSelect(e: React.UIEvent, props) {
        const { type, name } = props.item;

        const shouldHandle = IS_READY && type === "Favorites" && name === "Favorites";
        if (shouldHandle) {
            e.preventDefault();
            e.stopPropagation();
            await openGifMenuAsync(e);
        }

        props.onClick?.(props.item, props.index); // original function
    }
}
);



/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { ContextMenuApi, FluxDispatcher, Menu, React, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { DEFAULT_FOLDER_STEP, Folder, Gif } from "./classes";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

const FOLDERS: Map<string, Folder> = new Map<string, Folder>();

let LAST_VISITED_FOLDER: Folder;
let IS_READY = true;
let GIF_PICKER_CALLBACK;


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
    const key = `GifFolders:gifs:${UserStore.getCurrentUser().id}`;
    const allGifs: Record<string, Gif> | undefined = await getAllFavoritedGifsFromDB(key);
    if (!allGifs) {
        console.log("Failed to grab all gifs!");
        return;
    }

    const { url, ...rest } = gif;
    if (!url) {
        console.log("Failed to find the url in the gif...");
        return;
    }

    const highestOrder = Object.values(allGifs)
        .filter(gif => gif.order >= folder.start && gif.order < folder.end)
        .reduce((highest, gif) => highest > gif.order ? highest : gif.order, folder.start - 1);

    allGifs[url] = { ...rest, order: highestOrder };
    await DataStore.set(key, allGifs);
    showSelectedGifs(LAST_VISITED_FOLDER);
}

async function handleGifDelete(gif: Gif) {
    if (gif?.url === undefined) {
        console.log("Received invalid gif");
        return;
    }

    const key = `GifFolders:gifs:${UserStore.getCurrentUser().id}`;
    const allGifs: Record<string, Gif> | undefined = await getAllFavoritedGifsFromDB(key);
    if (!allGifs) {
        console.log("Failed to grab all gifs!");
        return;
    }

    if (!(gif.url in allGifs)) {
        console.log("Gif not found in the whole gif object!");
        return;
    }

    delete allGifs[gif.url];
    DataStore.set(key, allGifs); // continue modifying this
    showSelectedGifs(LAST_VISITED_FOLDER);
}

function openAddGifMenu(e: React.UIEvent, gif: Gif): Promise<Folder> {
    const folderList = Array.from(FOLDERS.values()); // not sure why, but using forEach makes the element disappear on hover


    return new Promise<Folder>(resolve => {
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
                        action={async () => {
                            handleGifAdd(folder, gif);
                            resolve(folder);
                        }}
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
    });
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
                            LAST_VISITED_FOLDER = folder;
                            resolve();
                        }}
                    />
                ))}
            </Menu.Menu>
        )
        );
    });
}

function generateProtoFromGifs(gifs: Record<string, Gif>) {
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
async function showSelectedGifs(folder?: Folder | null) {
    const key = `GifFolders:gifs:${UserStore.getCurrentUser().id}`;
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

// Need to use the RestApi because FrecencyAC.getCurrentValue()
// return the local array of gifs (affected by FluxDispatcher)
// this quickly hits the api limit, so will have to make a in memory store for gifs for later
async function getAllFavoritedGifs(): Promise<Record<string, Gif> | null> {
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


async function AddFolder(opts: CommandArgument[], cmd: CommandContext) {
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

async function DeleteFolder(opts: CommandArgument[], cmd: CommandContext) {
    if (!opts || !cmd || opts.length < 1) return;

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
    const storedFolders: Record<string, Folder> = await DataStore.get(key) ?? {};

    if (!storedFolders || !storedFolders.Default || Object.keys(storedFolders).length === 0) {
        await AddFolder([{ name: "add_folder", value: "Default" }], null);
        return;
    }

    const defaultFolder = storedFolders.Default;
    FOLDERS.set("Default", defaultFolder);

    for (const [key, value] of Object.entries(storedFolders)) {
        if (key !== "Default") FOLDERS.set(key, value);
    }


}

// So we are not going to modify the users gif, instead we are going to add everything they have
// and then fully use the Vencord db module
async function initializeGifs() {
    const allGifs: Record<string, Gif> | null = await getAllFavoritedGifs();
    if (!allGifs || Object.keys(allGifs).length === 0) {
        console.log("Failed to get all gifs or you don't have any gifs");
        return;
    }

    const key = `GifFolders:gifs:${UserStore.getCurrentUser().id}`;
    const storedGifs: Record<string, Gif> | undefined = await DataStore.get(key) ?? {};

    if (Object.keys(storedGifs).length === 0) {
        for (const [url, value] of Object.entries(allGifs)) {
            storedGifs[url] = value;
        }
    }

    await DataStore.set(key, storedGifs);
    console.log(DataStore);
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

    async start() {
        if (!UserStore.getCurrentUser()) return;

        await initializeFolder();
        if (!FrecencyAC || !FavoriteAC || !BINARY_READ_OPTIONS || !FOLDERS || FOLDERS.size === 0) {
            console.log("Failed to start the plugin...");
            IS_READY = false;
            return;
        }

        await initializeGifs();



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

        const folder = await openAddGifMenu(e, gif);
        console.log("The user selected the folder: ", folder);

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


// BUG: changing the folders from one to another while inside of the gif picker seems to break the order a bit
// add insertion checks

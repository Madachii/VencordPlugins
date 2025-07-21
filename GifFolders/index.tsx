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

const FrecencyUserSettingsActionCreators = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteGifSettingsActionCreators = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyUserSettingsActionCreators.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

let FOLDERS: Map<string, Folder> = new Map<string, Folder>();


function grabGifProp(e: React.UIEvent) {
    const node = e.currentTarget;
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber$")) as string;
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

function getCurrentFavoritedGifs(): GifMap | null {
    const raw = FrecencyUserSettingsActionCreators?.getCurrentValue()?.favoriteGifs?.gifs;
    return raw ?? null;
}

// change this to get the last free open index instead
// would it work to Set the values so the editing person can change folders easily?
async function handleGifAdd(folder: Folder, gif: Gif) { // using incrementing index for now, change later for unique ids or something
    const allGifs: GifMap = await getAllFavoritedGifs() as GifMap;
    const highestOrder = Object.values(allGifs)
        .filter(gif => gif.order >= folder.start && gif.order < folder.end)
        .reduce((highest, gif) => highest > gif.order ? highest : gif.order, folder.start - 1);

    const order = highestOrder + 1;
    if (order >= folder.end) return; // Should normally almost never reach this, but just in case...

    const { url, ...rest } = gif;
    await FrecencyUserSettingsActionCreators.updateAsync(
        "favoriteGifs",
        proto => {
            proto.gifs = { ...allGifs };
            proto.gifs[url as string] = { ...rest, order };
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

    const allGifs: GifMap = await getAllFavoritedGifs() as GifMap;
    if (!(gif.url in allGifs)) {
        console.log("Gif not found in the whole gif object!");
        return;
    }

    await FrecencyUserSettingsActionCreators.updateAsync(
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
                    label={`Add ${folder.name} to favourites`}
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

function openGifMenuAsync(e: React.UIEvent): Promise<Folder | null> {
    const folderList = Array.from(FOLDERS.values()); // not sure why, but using forEach makes the element disappear on hover

    return new Promise<Folder | null>(resolve => {
        ContextMenuApi.openContextMenu(e, () => (
            <Menu.Menu
                navId="madachi-gif-menu"
                aria-label="Madachi Gif Menu"
                onClose={async () => {
                    await FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });
                    resolve(null);
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
                            await FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });
                            resolve(folder);
                        }}
                    />
                ))}
            </Menu.Menu>
        )
        );
    });
}

function generateProtoFromGifs(gifs) {
    const currentGifsProto = FrecencyUserSettingsActionCreators.getCurrentValue().favoriteGifs;


    const newGifProto = currentGifsProto !== null ?
        FavoriteGifSettingsActionCreators.fromBinary(
            FavoriteGifSettingsActionCreators.toBinary(currentGifsProto),
            BINARY_READ_OPTIONS,
        ) :
        FavoriteGifSettingsActionCreators.create();

    newGifProto.gifs = gifs;

    const proto = FrecencyUserSettingsActionCreators.ProtoClass.create();
    proto.favoriteGifs = newGifProto;

    return proto;
}
async function showSelectedGifs(folder: Folder) {
    const allGifs = await getAllFavoritedGifs();
    const filteredGifs = Object.fromEntries(
        Object.entries(allGifs as GifMap)
            .filter(([, { order }]) => order >= folder.start && order <= folder.end)
            .map(([url, data]) => [url, { ...data }])
    );

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

// Need to use the RestApi because FrecencyUserSettingsActionCreators.getCurrentValue()
// return the local array of gifs (affected by FluxDispatcher)
async function getAllFavoritedGifs(): Promise<GifMap> {
    const { body } = await RestAPI.get({
        url: "/users/@me/settings-proto/2"
    });

    const bytes = Uint8Array.from(atob(body.settings), c => c.charCodeAt(0));
    const end = FrecencyUserSettingsActionCreators.ProtoClass.fromBinary(
        bytes,
        BINARY_READ_OPTIONS
    );

    return end.favoriteGifs.gifs;
}

async function AddFolder(opts, cmd) {
    if (opts.length < 1) return;

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
    if (name !== "delete_folder" || value === "Default") {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: "Cannot delete the Default folder!" });
    }

    if (FOLDERS.delete(value)) {
        DataStore.set(`GifFolders:${UserStore.getCurrentUser().id}`, Object.fromEntries(FOLDERS));
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Succesfully deleted the folder: ${value}! ` });
    }
    else {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Failed to delete folder ${value}, are you sure it exists?` });
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
        console.log("DATA STORE: ", DataStore);
        const key = `GifFolders:${UserStore.getCurrentUser().id}`;
        const storedFolders = await DataStore.get(key);

        if (!storedFolders || Object.keys(storedFolders).length === 0) {
            await AddFolder([{ name: "add_folder", value: "Default" }]);
            return;
        }
        FOLDERS = new Map(Object.entries(storedFolders ?? {}));
    },

    patches: [
        {
            find: "gifFavoriteButton,{",
            replacement: {
                match: /onClick:(\i)/,
                replace: "onClick:(e)=>( $self.saveGif(e))"
            }
        },
        {
            find: "\"handleCanPlay\",",
            replacement: {
                match: /\(\)=>{let[^)]*./,
                replace: "(event)=>{$self.onGifSelect(event, this.props);"
            }
        }
    ],

    // restore default if folder missing etc
    async saveGif(e: React.UIEvent) {
        e.preventDefault();
        e.stopPropagation();

        openAddGifMenu(e, grabGifProp(e));
    },

    async onGifSelect(e: React.UIEvent, props) {
        e.preventDefault();
        e.stopPropagation();

        const { type, name } = props.item;
        if (type === "Favorites" && name === "Favorites") {
            await openGifMenuAsync(e);
        }
        props.onClick !== null && props.onClick(props.item, props.index); // original function
    }
});



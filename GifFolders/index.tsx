/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { ContextMenuApi, FluxDispatcher, Menu, React, RestAPI, UserSettingsActionCreators } from "@webpack/common";

import { DEFAULT_FOLDER_STEP, Folder, Gif, GifMap } from "./classes";
import { searchProtoClassField } from "./utils";

const FrecencyUserSettingsActionCreators = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteGifSettingsActionCreators = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyUserSettingsActionCreators.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");


const defaultFolders: string[] = ["Default", "Hugs", "Kisses", "Hearts"];
const GifFolders: Folder[] = defaultFolders.map((name, id) => {
    const start = id * DEFAULT_FOLDER_STEP + 1;
    return {
        id,
        name,
        start,
        end: start + DEFAULT_FOLDER_STEP - 1
    };
});

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

function getFavoritedGifs(): GifMap | null {
    const raw = FrecencyUserSettingsActionCreators?.getCurrentValue()?.favoriteGifs?.gifs;
    return raw ?? null;
}

async function updateGifs() {
    console.log("Starting madachi's plugin! With love for Namel3ss :3");
    console.log("Frecency:", FrecencyUserSettingsActionCreators);

    const currentGifs =
        FrecencyUserSettingsActionCreators.getCurrentValue().favoriteGifs;

    const newGifProto = currentGifs != null
        ? FavoriteGifSettingsActionCreators.fromBinary(
            FavoriteGifSettingsActionCreators.toBinary(currentGifs),
            BINARY_READ_OPTIONS,
        )
        : FavoriteGifSettingsActionCreators.create();

    const newfavoriteGifs = FavoriteGifSettingsActionCreators.create({
        gifs: {
            "": {
                format: 2,
                src: "",
                width: 498,
                height: 282,
                order: 1
            },
            "...": {
                format: 1,
                src: "",
                width: 240,
                height: 426,
                order: 2500
            }
        },
        hideTooltip: false
    });

    newGifProto.gifs = newfavoriteGifs.gifs;
    newGifProto.hideTooltip = newfavoriteGifs.hideTooltip;

    const proto = FrecencyUserSettingsActionCreators.ProtoClass.create();
    proto.favoriteGifs = newGifProto;

    console.log("Our proto is: ", proto);

    // const result = FluxDispatcher.dispatch({
    //     type: "USER_SETTINGS_PROTO_UPDATE",
    //     local: false,
    //     partial: true,
    //     settings: {
    //         type: 2,
    //         proto: proto
    //     }
    // });
    await FrecencyUserSettingsActionCreators.updateAsync(
        "favoriteGifs",
        data => {
            Object.assign(data.gifs, newfavoriteGifs.gifs);
            data.hideTooltip = false;
        },
        0
    );
    // console.log("Post Dispatch", result);

}

// change this to get the last free open index instead
async function handleGifAdd(folder: Folder, gif: Gif) { // using incrementing index for now, change later for unique ids or something
    const allGifs: GifMap = await getAllFavoritedGifs() as GifMap;
    const taken = new Set(
        Object.values(allGifs)
            .filter(gif => gif.order >= folder.start && gif.order <= folder.end)
            .map(gif => gif.order)
    );

    let order = folder.start === 0 ? 1 : folder.start;
    for (let s = order; s <= folder.end; s++) {
        if (!taken.has(s)) {
            order = s;
            break;
        }
    }

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

async function handleGifDelete(gif: Gif) {
    await FrecencyUserSettingsActionCreators.updateAsync(
        "favoriteGifs",
        data => {
            delete data.gifs[gif.url as string];
            data.hideTooltip = false;
        },
        0
    );
}

function AddGifMenu(gif) {
    return (
        <Menu.Menu
            navId="madachi-gif-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Madachi Gif Menu"
        >
            {GifFolders.map(folder => (
                <Menu.MenuItem
                    key={`folder-${folder.id}`}
                    id={`favorite-folder-${folder.id}`}
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
    );
}

function openGifMenuAsync(e: React.UIEvent): Promise<Folder | null> {
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
                {GifFolders.map(folder => (
                    <Menu.MenuItem
                        key={`open-folder-${folder.id}`}
                        id={`open-folder-${folder.id}`}
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
    console.log("Current gif proto", currentGifsProto);

    const newGifProto = currentGifsProto != null
        ? FavoriteGifSettingsActionCreators.fromBinary(
            FavoriteGifSettingsActionCreators.toBinary(currentGifsProto),
            BINARY_READ_OPTIONS,
        )
        : FavoriteGifSettingsActionCreators.create();

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

export default definePlugin({
    name: "Madachi",
    description: "Makes it possible to organize gifs in folders, currently not working",
    authors: [{
        name: "You!",
        id: 0n
    }],

    // add start check to make sure Frequencecy Action Center is there and the others, else no point
    start() { console.log("Favorite gifs: ", getFavoritedGifs()); },
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

    async saveGif(e: React.UIEvent) {
        e.preventDefault();
        e.stopPropagation();
        e.persist();


        const favoritedGif: Gif = grabGifProp(e);
        console.log("favoritedGifs", favoritedGif);
        ContextMenuApi.openContextMenu(e, () => AddGifMenu(favoritedGif));
        // showSelectedGifs();
        // console.log(getFavoritedGifs());
        const full = await getAllFavoritedGifs();
        console.log("Full is: ", full);

    },

    async onGifSelect(e: React.UIEvent, props) {
        e.preventDefault();
        e.stopPropagation();
        e.persist();

        const { type, name } = props.item;
        if (type === "Favorites" && name === "Favorites") {
            await openGifMenuAsync(e);
        }
        props.onClick !== null && props.onClick(props.item, props.index); // original function
    }
});

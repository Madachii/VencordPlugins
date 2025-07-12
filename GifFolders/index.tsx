/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { ContextMenuApi, FluxDispatcher, Menu, React, UserSettingsActionCreators } from "@webpack/common";

const FrecencyUserSettingsActionCreators = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteGifSettingsActionCreators = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyUserSettingsActionCreators.ProtoClass));

const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

interface Gif {
    className: string,
    src: string,
    url: string,
    width: number,
    height: number,
    format: number,
    order: number,
}

interface Folder {
    id: number;
    name: string;
    start: number;
    end: number;
}


const FOLDER_ORDER_STEP = 10000; // order is a uint32
const DELAY = 400;
const defaultFolders: string[] = ["Default", "Hugs", "Kisses", "Hearts"];

const GifFolders: Folder[] = defaultFolders.map((name, id) => {
    const start = id * FOLDER_ORDER_STEP;
    return {
        id,
        name,
        start,
        end: start + FOLDER_ORDER_STEP - 1
    };
});


function searchProtoClassField(localName: string, protoClass: any) {
    const field = protoClass?.fields?.find((field: any) => field.localName === localName);
    if (!field) return;

    const fieldGetter = Object.values(field).find(value => typeof value === "function") as any;
    return fieldGetter?.();
}


function grabGifProp(e: React.MouseEvent) {
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


function getFavoritedGifs(): Gif[] | null {
    const raw = FrecencyUserSettingsActionCreators?.getCurrentValue()?.favoriteGifs?.gifs as Record<string, Gif> | undefined;

    if (!raw) return null;

    return Object.entries(raw).map(([url, data]) => ({
        url,
        src: data.src,
        format: data.format,
        className: data.className,
        width: data.width,
        height: data.height,
        order: data.order,
    }));
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
            "": {
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

async function handleGifAdd(folderIdx: number, gif: Gif) { // using incrementing index for now, change later for unique ids or something
    const folder: Folder = GifFolders[folderIdx];
    const gifs: Gif[] = getFavoritedGifs() as Gif[];
    const taken = new Set(gifs.filter(i => i.order >= folder.start && i.order <= folder.end).map(i => i.order));

    console.log(gifs);

    let freeSpot = folder.start === 0 ? 1 : folder.start;
    for (let s = freeSpot; s <= folder.end; s++) {
        console.log("Trying to check if there's a free spot at: ", s);
        if (!taken.has(s)) {
            freeSpot = s;
            break;
        }
    }

    const { url, ...gifProps } = gif;

    const newfavoriteGifs = FavoriteGifSettingsActionCreators.create({
        gifs: {
            [url]: {
                ...gifProps,
                order: freeSpot
            }
        },
        hideTooltip: false
    });

    await FrecencyUserSettingsActionCreators.updateAsync(
        "favoriteGifs",
        data => {
            Object.assign(data.gifs, newfavoriteGifs.gifs);
            data.hideTooltip = false;
        },
        0 // I'm not sure if this delay is needed
    );
}

async function handleGifDelete(gif: Gif) {
    await FrecencyUserSettingsActionCreators.updateAsync(
        "favoriteGifs",
        data => {
            delete data.gifs[gif.url];
            data.hideTooltip = false;
        },
        0
    );
}

function GifMenu(gif: Gif) {
    return (
        <Menu.Menu
            navId="madachi-gif-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Madachi Gif Menu"
        >
            {defaultFolders.map((folder, i) => (
                <Menu.MenuItem
                    key={`folder-${i}`}
                    id={`favorite-folder-${i}`}
                    label={`Add ${folder} to favourites`}
                    color="brand"
                    action={() => handleGifAdd(i, gif)}
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

function showSelectedGifs() {
    const currentGifsProto = FrecencyUserSettingsActionCreators.getCurrentValue().favoriteGifs;
    console.log("CurrentGifProto:", currentGifsProto);

    const filteredGifs = Object.fromEntries(
        Object.entries(currentGifsProto.gifs as Gif[])
            .filter(([, { order }]) => order >= 30000 && order <= 40000)
            .map(([url, data]) => [url, { ...data }])
    );

    console.log("Filtered gifs:", filteredGifs);
    const newGifProto = currentGifsProto != null
        ? FavoriteGifSettingsActionCreators.fromBinary(
            FavoriteGifSettingsActionCreators.toBinary(currentGifsProto),
            BINARY_READ_OPTIONS,
        )
        : FavoriteGifSettingsActionCreators.create();

    newGifProto.gifs = filteredGifs;

    const proto = FrecencyUserSettingsActionCreators.ProtoClass.create();
    proto.favoriteGifs = newGifProto;

    FluxDispatcher.dispatch({
        type: "USER_SETTINGS_PROTO_UPDATE",
        local: true,
        partial: true,
        settings: {
            type: 2,
            proto: proto
        }
    });
}
export default definePlugin({
    name: "Madachi",
    description: "Makes it possible to organize gifs in folders, currently not working",
    authors: [{
        name: "You!",
        id: 0n
    }],

    // add start check to make sure Frequencecy Action Center is there and the others, else no point
    start() {
        console.log("Frecency:", FrecencyUserSettingsActionCreators);
        console.log("Folders", GifFolders);
    },
    patches: [
        {
            find: "gifFavoriteButton,{",
            replacement: {
                match: /onClick:(\i)/,
                replace: "onClick:(e)=>( $self.saveGif(e))"
            }
        }
    ],

    saveGif(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
        e.preventDefault();
        e.stopPropagation();
        e.persist();

        const favoritedGif: Gif = grabGifProp(e);
        ContextMenuApi.openContextMenu(e, () => GifMenu(favoritedGif));
        showSelectedGifs();
    }
});


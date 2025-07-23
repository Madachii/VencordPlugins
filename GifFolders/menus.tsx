/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, FluxDispatcher, Menu } from "@webpack/common";

import { Folder } from "./folders";
import { Gif, handleGifAdd, handleGifDelete, showSelectedGifs } from "./gifStore";

export function openAddGifMenu(e: React.UIEvent, gif: Gif, folderMap: Map<string, Folder>, lastVisited: Folder | null = null): Promise<Folder | null> {
    const folderList = Array.from(folderMap.values()); // not sure why, but using forEach makes the element disappear on hover

    return new Promise<Folder | null>(resolve => {
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
                            await handleGifAdd(folder, gif, lastVisited);
                            resolve(folder);
                        }}
                    />
                ))}
                <Menu.MenuItem
                    id={"delete-favorite"}
                    label={"Delete"}
                    color="danger"
                    action={async () => {
                        await handleGifDelete(gif, lastVisited);
                        resolve(lastVisited);
                    }}
                />
            </Menu.Menu>
        ));
    });
}

export function openGifMenuAsync(e: React.UIEvent, folderMap: Map<string, Folder>): Promise<Folder> {
    const folderList = Array.from(folderMap.values()); // not sure why, but using forEach makes the element disappear on hover

    return new Promise<Folder>(resolve => {
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
                            resolve(folder);
                        }}
                    />
                ))}
            </Menu.Menu>
        )
        );
    });
}

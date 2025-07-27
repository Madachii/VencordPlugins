/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, FluxDispatcher, Menu } from "@webpack/common";
import { ReactNode } from "react";

import { Folder } from "./folders";
import { Gif, handleGifAdd, handleGifDelete, showSelectedGifs } from "./gifStore";

class MenuBuilder {
    private gif: Gif | undefined;
    private lastVisited: Folder | undefined;

    private items: ReactNode[] = [];
    private onClose: () => void = () => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });

    constructor(gif?: Gif, lastVisited?: Folder | undefined) {
        this.gif = gif;
        this.lastVisited = lastVisited;
    }

    addFolder(name: string, prefix: string, action: () => Promise<Record<string, Gif> | Folder | undefined>) {
        this.items.push(
            <Menu.MenuItem
                key={`folder-${name}`}
                id={`favorite-folder-${name}`}
                label={`${prefix} ${name}`}
                color="brand"
                action={async () => { await action(); }}
            />
        );

        return this;
    }

    addDelete(action: () => Promise<Record<string, Gif> | undefined>) {
        this.items.push(
            <Menu.MenuItem
                id={"delete-favorite"}
                label={"Delete"}
                color="danger"
                action={async () => { await action(); }}
            />
        );
        return this;
    }

    build() {
        return (
            <Menu.Menu navId="gif-folder-menu" onClose={this.onClose}>
                {this.items}
            </Menu.Menu>
        );
    }
}

export async function openAddGifMenu(e: React.UIEvent, gif: Gif, folderMap: Map<string, Folder>, lastVisited: Folder | undefined = undefined): Promise<Record<string, Gif> | undefined> {
    const folders = Array.from(folderMap.values());

    return new Promise(resolve => {
        const builder = new MenuBuilder(gif, lastVisited);

        folders.forEach(folder =>
            builder.addFolder(folder.name, "Add to", async () => {
                const result = await handleGifAdd(folder, gif, lastVisited);
                resolve(result);
                return result;
            })
        );

        builder.addDelete(async () => {
            const result = await handleGifDelete(gif, lastVisited);
            resolve(result);
            return result;
        });

        ContextMenuApi.openContextMenu(e, () => builder.build());
    });
}

export function openGifMenuAsync(e: React.UIEvent, folderMap: Map<string, Folder>): Promise<Folder> {
    const folders = Array.from(folderMap.values());

    return new Promise(resolve => {
        const builder = new MenuBuilder();

        folders.forEach(folder => {
            builder.addFolder(folder.name, "Open", async () => {
                await showSelectedGifs(folder);
                resolve(folder);
                return folder;
            });
        });

        ContextMenuApi.openContextMenu(e, () => builder.build());
    });
}

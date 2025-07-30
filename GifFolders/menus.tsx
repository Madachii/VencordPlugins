/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, FluxDispatcher, Menu } from "@webpack/common";
import { ReactNode } from "react";

import { Folder } from "./folders";
import { Gif, handleGifAdd, handleGifDelete } from "./gifStore";

class MenuBuilder {
    private gif: Gif | undefined;
    private lastVisited: Folder | undefined;

    private items: ReactNode[] = [];
    private onClose: () => void = () => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });

    constructor(gif?: Gif) {
        this.gif = gif;
    }

    addFolder(name: string, label: string, action: () => Promise<void>, color: string = "brand") {
        this.items.push(
            <Menu.MenuItem
                key={`folder-${name}`}
                id={`favorite-folder-${name}`}
                label={`${label}`}
                color={color}
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

export function openAddGifMenu(e: React.UIEvent, gif: Gif, folderMap: Map<string, Folder>): Promise<{ gifs?: Record<string, Gif>, folder?: Folder; }> | undefined {
    const folders = Array.from(folderMap.values());

    return new Promise(resolve => {
        const builder = new MenuBuilder(gif);

        folders.forEach(folder =>
            builder.addFolder(folder.name, `Save to ${folder.name}`, async () => {
                const result = await handleGifAdd(folder, gif);
                resolve({ gifs: result });
            })
        );

        builder.addFolder("delete", "Delete", async () => {
            const result = await handleGifDelete(gif);
            resolve({ gifs: result });
        }, "danger");

        ContextMenuApi.openContextMenu(e, () => builder.build());
    });
}

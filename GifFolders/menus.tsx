/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, FluxDispatcher, Menu, showToast } from "@webpack/common";
import { ReactNode } from "react";

import { Folder } from "./folders";
import { addLocalGif, addRemoteGif, deleteLocalGif, deleteRemoteGif, } from "./gifStore";
import { AddGifMenuResult, RawGif } from "./types";

class MenuBuilder {
    private items: ReactNode[] = [];
    private onClose = () => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });

    addFolder(name: string, label: string, action: () => Promise<void>, color: string = "brand") {
        this.items.push(
            <Menu.MenuItem
                key={`folder-${name}`}
                id={`favorite-folder-${name}`}
                label={`${label}`}
                color={color}
                action={action}
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

export function openGifMenu(e: React.UIEvent, gif: RawGif, folderMap: Record<string, Folder>): Promise<AddGifMenuResult> | undefined {
    return new Promise(resolve => {
        const builder = new MenuBuilder();

        builder.addFolder("discord", "Save to Discord", async () => {
            console.log("Trying to save to discord!");
            await addRemoteGif(gif);

            showToast("Saved to discord!");
            resolve({});
        });

        for (const folder of Object.values(folderMap)) {
            builder.addFolder(folder.name, `Save to ${folder.name}`, async () => {
                console.log("Trying to save to a folder!");
                const result = await addLocalGif(folder, gif);

                showToast(`Saved to ${folder.name}!`);
                resolve({ gifs: result });
            });
        }

        builder.addFolder("delete", "Delete", async () => {
            console.log("Trying to delete a gif!");
            const result = await deleteLocalGif(gif);
            await deleteRemoteGif(gif);

            showToast("Gif deleted!");
            resolve({ gifs: result });
        }, "danger");

        ContextMenuApi.openContextMenu(e, () => builder.build());
    });
}

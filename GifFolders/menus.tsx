/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DeleteIcon } from "@components/Icons";
import { ContextMenuApi, FluxDispatcher, Menu, showToast } from "@webpack/common";
import { ComponentType, ReactNode } from "react";

import { Folder } from "./folders";
import { gifStore } from "./gifStoreEx";
import { DiscordIcon, FolderIcon } from "./icons";
import { AddGifMenuResult, RawGif } from "./types";

class MenuBuilder {
    private items: ReactNode[] = [];
    private onClose: () => void;
    private pendingAction: Promise<void> | null = null;

    constructor(onCloseCallback: () => void) {
        this.onClose = () => onCloseCallback;
    }

    addFolder(name: string, label: string, action: () => Promise<void>, icon: ComponentType<any>, color: string = "brand") {
        this.items.push(
            <Menu.MenuItem
                key={`folder-${name}`}
                id={`favorite-folder-${name}`}
                label={`${label}`}
                color={color}
                action={() => {
                    this.pendingAction = action();
                }}
                icon={icon}
            />
        );
        return this;
    }

    build() {
        return (
            <Menu.Menu
                navId="gif-folder-menu"
                onClose={() => {
                    FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });
                    if (this.pendingAction) {
                        this.pendingAction.finally(() => this.onClose());
                    } else {
                        this.onClose();
                    }
                }}
            >
                {this.items}
            </Menu.Menu>
        );
    }
}

export function openGifMenu(e: React.UIEvent, gif: RawGif, folderMap: Record<string, Folder>): Promise<AddGifMenuResult> | undefined {
    return new Promise(resolve => {
        const builder = new MenuBuilder(() => resolve({}));

        builder.addFolder("discord", "Save to Discord", async () => {
            console.log("Trying to save to discord!");
            await gifStore.addRemoteGif(gif);

            showToast("Saved to discord!");
            resolve({});
        }, DiscordIcon, "brand");

        for (const folder of Object.values(folderMap)) {
            builder.addFolder(folder.name, `Save to ${folder.name}`, async () => {
                console.log("Trying to save to a folder!");
                const result = await gifStore.addLocalGif(folder, gif);

                showToast(`Saved to ${folder.name}!`);
                resolve({ gifs: result });
            }, FolderIcon);
        }

        builder.addFolder("delete", "Delete", async () => {
            console.log("Trying to delete a gif!");
            const result = await gifStore.deleteLocalGif(gif);
            await gifStore.deleteRemoteGif(gif);

            showToast("Gif deleted!");
            resolve({ gifs: result });
        }, DeleteIcon, "danger");

        ContextMenuApi.openContextMenu(e, () => builder.build());
    });
}

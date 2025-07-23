/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { UserStore } from "@webpack/common";


export interface Folder {
    idx: number;
    name: string;
    start: number;
    end: number;
}

const FOLDERS: Map<string, Folder> = new Map<string, Folder>();
const DEFAULT_FOLDER_STEP = 10 ** 5;


function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) return undefined;
    return `GifFolders:folders:${id}`;
}


export const getFolders = (): Map<string, Folder> => FOLDERS;

export async function AddFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length < 1) return; // left off here

    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while adding folder");
        return;
    }

    let { name, value } = opts[0];
    if (name !== "add_folder") return;

    value = value.toLowerCase();
    if (FOLDERS.get(value)) {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `You already have a folder called ${value}!: ` });
        return;
    }

    const uint32_max = 0xFFFFFFFF - 1;
    const folder = {
        idx: FOLDERS.size,
        name: value,
        start: value === "default" ? 1 : FOLDERS.size * DEFAULT_FOLDER_STEP + 1,
        end: value === "default" ? uint32_max : FOLDERS.size * DEFAULT_FOLDER_STEP + DEFAULT_FOLDER_STEP
    };

    FOLDERS.set(value, folder);
    DataStore.set(key, Object.fromEntries(FOLDERS));

    cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Succesfully created a new folder called: ${value}! ` });
}

export async function DeleteFolder(opts: CommandArgument[], cmd: CommandContext) {
    if (!opts || !cmd || opts.length < 1) return;

    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while deleting folder");
        return;
    }

    let { name, value } = opts[0];
    if (name !== "delete_folder") return;

    value = value.toLowerCase();
    if (value === "default") {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: "Cannot delete the Default folder!" });
        return;
    }

    if (FOLDERS.delete(value)) {
        DataStore.set(key, Object.fromEntries(FOLDERS));
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Succesfully deleted the folder: ${value}! ` });
    }
    else {
        cmd?.channel?.id && sendBotMessage(cmd.channel.id, { content: `Failed to delete folder ${value}, are you sure it exists?` });
    }
}

export async function initializeFolder(): Promise<boolean> {
    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while initializing folders");
        return false;
    }

    const storedFolders: Record<string, Folder> = await DataStore.get(key) ?? {};

    if (Object.keys(storedFolders).length === 0 || !storedFolders.default) {
        await AddFolder([{ name: "add_folder", value: "default" }], null);
        console.log("Added folder and exited!");
        return FOLDERS.size > 0;
    }

    const defaultFolder = storedFolders.default;
    FOLDERS.set("default", defaultFolder);

    for (const [key, value] of Object.entries(storedFolders)) {
        if (key !== "default") FOLDERS.set(key, value);
    }

    return true;
}


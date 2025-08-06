/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { showToast, UserStore } from "@webpack/common";



export interface Folder {
    idx: number;
    name: string;
    start: number;
    end: number;
}

const FOLDERS: Map<string, Folder> = new Map<string, Folder>();
export const DEFAULT_FOLDER_STEP = 10 ** 5;
export const getFolders = (): Map<string, Folder> => FOLDERS;

function getKey() {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) return undefined;
    return `GifFolders:folders:${id}`;
}

export async function AddFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length < 1) return;

    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while adding folder");
        return;
    }

    let { value } = opts[0];

    value = value.toLowerCase();
    if (FOLDERS.get(value)) {
        showToast(`You already have a folder called ${value}!: `);
        return;
    }

    const afterLast = [...FOLDERS.values()][FOLDERS.size - 1].idx + 1;
    const folder = {
        idx: afterLast,
        name: value,
        start: afterLast * DEFAULT_FOLDER_STEP + 1,
        end: afterLast * DEFAULT_FOLDER_STEP + DEFAULT_FOLDER_STEP
    };

    FOLDERS.set(value, folder);
    DataStore.set(key, Object.fromEntries(FOLDERS));

    showToast(`Succesfully created a new folder called: ${value}! `);
}

export async function RenameFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length < 1) return;

    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while adding folder");
        return;
    }

    if (opts.length !== 2) {
        showToast("Please add the old name and also the new name!");
        return;
    }

    opts.sort((a, b) => b.name.localeCompare(a.name));

    const old_name = opts[0].value.toLowerCase();
    const new_name = opts[1].value.toLowerCase();
    if (old_name === new_name) return;
    if (new_name.length <= 0) {
        showToast("Please make a valid new name!");
        return;
    }

    const old_folder = FOLDERS.get(old_name);
    if (!old_folder) {
        new Logger("GifFolderS").error("Failed to get old folder");
        return;
    }
    old_folder.name = new_name;

    FOLDERS.delete(old_name);
    FOLDERS.set(new_name, old_folder);

    showToast(`Succesfully renamed from ${old_name} to ${new_name}!`);
    await DataStore.set(key, Object.fromEntries(FOLDERS));
}

export async function SwapFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length < 1) return;

    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while adding folder");
        return;
    }

    if (opts.length !== 2) {
        showToast("Please add the old name and also the new name!");
        return;
    }

    opts.sort((a, b) => b.name.localeCompare(a.name));

    const old_name = opts[0].value.toLowerCase();
    const new_name = opts[1].value.toLowerCase();
    if (old_name === new_name) return;
    if (new_name.length <= 0) {
        showToast("Please make a valid new name!");
        return;
    }

    const old_folder = FOLDERS.get(old_name);
    const new_folder = FOLDERS.get(new_name);
    if (!old_folder || !new_folder) {
        new Logger("GifFolderS").error("Failed to get old folder");
        return;
    }

    FOLDERS.set(old_name, { ...old_folder, name: new_name });
    FOLDERS.set(new_name, { ...new_folder, name: old_name });

    console.log("OLD FOLDER: ", old_folder, " NEW FOLDER: ", new_folder);

    showToast(`Succesfully swapped index of ${old_name} to ${new_name}!`);
    await DataStore.set(key, Object.fromEntries(FOLDERS));
}
export async function DeleteFolder(opts: CommandArgument[], cmd: CommandContext) {
    if (!opts || !cmd || opts.length < 1) return;

    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while deleting folder");
        return;
    }

    let { value } = opts[0];
    value = value.toLowerCase();
    if (FOLDERS.delete(value)) {
        await DataStore.set(key, Object.fromEntries(FOLDERS));
        showToast(`Succesfully deleted the folder: ${value}!`);
    }
    else {
        showToast(`Failed to delete folder ${value}, are you sure it exists ? `);
    }
}

export async function initializeFolder(): Promise<boolean> {
    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while initializing folders");
        return false;
    }

    const storedFolders: Record<string, Folder> = await DataStore.get(key) ?? {};
    for (const [key, value] of Object.entries(storedFolders)) {
        FOLDERS.set(key, value);
    }

    return true;
}


/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption } from "@api/Commands";
import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { showToast, UserStore } from "@webpack/common";

export type Folder = {
    idx: number;
    name: string;
    start: number;
    end: number;
};

export type FolderMap = Record<string, Folder>;

const FOLDERS: FolderMap = {};

export const DEFAULT_FOLDER_STEP = 10 ** 5;
export const getFolders = () => FOLDERS;

function getKey(): string | undefined {
    const id = UserStore?.getCurrentUser()?.id;
    if (!id) return undefined;

    return `GifFolders:folders:${id}`;
}

async function updateFolders(folders: FolderMap) {
    const key = getKey();
    if (!key) return;

    await DataStore.set(key, folders);
}

export async function AddFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length < 1) return;

    const folder_name = findOption(opts, "folder_name", "")?.toLowerCase();
    if (FOLDERS[folder_name]) {
        showToast(`You already have a folder called ${folder_name}!: `);
        return;
    }

    const folderValues = Object.values(FOLDERS);
    const afterLast = folderValues.reduce((max, folder) => Math.max(max, folder.idx), - 1) + 1;
    const folder = {
        idx: afterLast,
        name: folder_name,
        start: afterLast * DEFAULT_FOLDER_STEP + 1,
        end: afterLast * DEFAULT_FOLDER_STEP + DEFAULT_FOLDER_STEP,
    };

    FOLDERS[folder_name] = folder;
    await updateFolders(FOLDERS);

    showToast(`Succesfully created a new folder called: ${folder_name}! `);
}

export async function RenameFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length < 1) return;

    if (opts.length !== 2) {
        showToast("Please add the old name and also the new name!");
        return;
    }

    const old_name = findOption(opts, "old_name", "")?.toLowerCase();
    const new_name = findOption(opts, "new_name", "")?.toLowerCase();
    if (!old_name || !new_name || old_name === new_name) return;
    if (!new_name.length) {
        showToast("Please make a valid new name!");
        return;
    }

    const old_folder = FOLDERS[old_name];
    if (!old_folder) {
        new Logger("GifFolder").error("Failed to get old folder");
        return;
    }
    old_folder.name = new_name;

    delete FOLDERS[old_name];
    FOLDERS[new_name] = old_folder;

    showToast(`Succesfully renamed from ${old_name} to ${new_name}!`);
    await updateFolders(FOLDERS);
}

export async function SwapFolder(opts: CommandArgument[], cmd?: CommandContext) {
    if (!opts || opts.length !== 2) return;

    const firstName = findOption(opts, "first", "")?.toLowerCase();
    const secondName = findOption(opts, "second", "")?.toLowerCase();
    if (firstName === secondName) {
        showToast("Folder names cannot be the same!");
        return;
    }

    const first = FOLDERS[firstName];
    const second = FOLDERS[secondName];
    if (!first || !second) {
        showToast("One or both folders not found!");
        return;
    }

    [first.idx, second.idx] = [second.idx, first.idx];

    await updateFolders(FOLDERS);
    showToast(`Swapped ${firstName} with ${secondName}!`);
}
export async function DeleteFolder(opts: CommandArgument[], cmd: CommandContext) {
    if (!opts || !cmd || opts.length < 1) return;

    let { value } = opts[0];
    value = value.toLowerCase();
    if (delete FOLDERS[value]) {
        await updateFolders(FOLDERS);
        showToast(`Succesfully deleted the folder: ${value}!`);
    } else {
        showToast(`Failed to delete folder ${value}`);
    }
}

export async function initializeFolder(): Promise<boolean> {
    const key = getKey();
    if (!key) {
        new Logger("GifFolders").error("Failed to get id while initializing folders");
        return false;
    }

    Object.assign(FOLDERS, (await DataStore.get(key)) ?? {});

    return true;
}

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

export const DEFAULT_FOLDER_STEP = 10 ** 5;

export class FolderStore {
    private logger: Logger;

    private folders: FolderMap = {};

    constructor() {
        this.logger = new Logger("GifFolders");
    }

    async init(logger?: Logger) {
        if (logger) this.logger = logger;

        const key = this.getKey();
        if (!key) {
            this.logger.error("Failed to get id while initializing folders");
            return false;
        }

        this.folders = (await DataStore.get(key)) ?? {};
        return true;
    }

    public dispose(): void {
        this.folders = {};
    }

    public getFolders(): FolderMap {
        return this.folders;
    }

    public async addFolder(opts: CommandArgument[], cmd?: CommandContext) {
        if (!opts || opts.length < 1) return;

        const folder_name = findOption(opts, "folder_name", "")?.toLowerCase();
        if (this.folders[folder_name]) {
            showToast(`You already have a folder called ${folder_name}!: `);
            return;
        }

        const folderValues = Object.values(this.folders);
        const afterLast = folderValues.reduce((max, folder) => Math.max(max, folder.idx), -1) + 1;
        const folder: Folder = {
            idx: afterLast,
            name: folder_name,
            start: afterLast * DEFAULT_FOLDER_STEP + 1,
            end: afterLast * DEFAULT_FOLDER_STEP + DEFAULT_FOLDER_STEP,
        };

        this.folders[folder_name] = folder;
        await this.updateFolders();

        showToast(`Succesfully created a new folder called: ${folder_name}! `);
    }

    public async renameFolder(opts: CommandArgument[], cmd?: CommandContext) {
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

        const old_folder = this.folders[old_name];
        if (!old_folder) {
            this.logger.error("Failed to get old folder");
            return;
        }
        old_folder.name = new_name;

        delete this.folders[old_name];
        this.folders[new_name] = old_folder;

        showToast(`Succesfully renamed from ${old_name} to ${new_name}!`);
        await this.updateFolders();
    }

    public async swapFolder(opts: CommandArgument[], cmd?: CommandContext) {
        if (!opts || opts.length !== 2) return;

        const firstName = findOption(opts, "first", "")?.toLowerCase();
        const secondName = findOption(opts, "second", "")?.toLowerCase();
        if (firstName === secondName) {
            showToast("Folder names cannot be the same!");
            return;
        }

        const first = this.folders[firstName];
        const second = this.folders[secondName];
        if (!first || !second) {
            showToast("One or both folders not found!");
            return;
        }

        [first.idx, second.idx] = [second.idx, first.idx];

        await this.updateFolders();
        showToast(`Swapped ${firstName} with ${secondName}!`);
    }

    public async deleteFolder(opts: CommandArgument[], cmd: CommandContext) {
        if (!opts || !cmd || opts.length < 1) return;

        let { value } = opts[0];
        value = value.toLowerCase();
        if (delete this.folders[value]) {
            await this.updateFolders();
            showToast(`Succesfully deleted the folder: ${value}!`);
        } else {
            showToast(`Failed to delete folder ${value}`);
        }
    }

    private getKey(): string | undefined {
        const id = UserStore?.getCurrentUser()?.id;
        if (!id) return undefined;

        return `GifFolders:folders:${id}`;
    }

    private async updateFolders() {
        const key = this.getKey();
        if (!key) return;

        await DataStore.set(key, this.folders);
    }
}

export const folderStore = new FolderStore();

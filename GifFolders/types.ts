/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Folder } from "./folders";

export type TrendingCategory = {
    name: string;
    src: string;
    type: string;
    format: number;
};

export interface FolderPreviewGif {
    src: string;
    format: number;
}

export interface AddGifMenuResult {
    gifs?: GifRecord;
    folder?: Folder;
}

export type GifRecord = Record<string, GifData>;

export interface GifImportOptions {
    importNew: boolean;
}


export type RawGif = {
    url: string,
    src: string,
    format: number,
    height: number,
    width: number
};

export type Gif = RawGif & { order: number };

export type GifData = Omit<Gif, "url">;

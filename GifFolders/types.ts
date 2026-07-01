/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Folder } from "./folders";

export interface TrendingCategory {
    name: string;
    src: string;
    type: string;
    format: number;
}

export interface FolderPreviewGif {
    src: string;
    format: number;
}

export interface AddGifMenuResult {
    gifs?: GifMap;
    folder?: Folder;
}

export type GifMap = Record<string, GifData>;

export interface GifImportOptions {
    importNew: boolean;
}


export type RawGif = {
    url: string,
    src: string,
    format: number,
    height: number,
    width: number
}

export type Gif = RawGif & { order: number }

export type GifData = Omit<Gif, "url">;

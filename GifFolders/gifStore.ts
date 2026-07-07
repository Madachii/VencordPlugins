/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { parseUrl } from "@utils/misc";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { FluxDispatcher, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { DEFAULT_FOLDER_STEP, Folder, FolderMap } from "./folderStore";
import { FolderPreviewGif, GifRecord, RawGif, TrendingCategory } from "./types";
import { searchProtoClassField } from "./utils";

const FrecencyAC = proxyLazyWebpack(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);
const FavoriteAC = proxyLazyWebpack(() => searchProtoClassField("favoriteGifs", FrecencyAC.ProtoClass));
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

const NEXT_DAY_MS = 1000 * 60 * 60 * 24;


export class GifStore {
    private logger: Logger | undefined;

    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private remoteTimer: ReturnType<typeof setTimeout> | null = null;

    private localGifsCache: GifRecord | null = null;

    // We are keeping a local copy of the remote gifs, because the local one gets modified with the new orders
    // I think discord retries request on rate-limit or others, so technically this should stay in sync fully?
    private remoteGifs: GifRecord = {};

    private readonly previews = new Map<number, FolderPreviewGif>();


    async init(logger?: Logger) {
        this.logger = logger;

        this.refreshLocalStaleGifs();
        await this.syncRemoteGifs();
        await this.syncLocalGifs(this.remoteGifs);
        await this.setFolderPreviewGifs();

        return true;
    }

    public dispose(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = null;

        if (this.remoteTimer) clearTimeout(this.remoteTimer);
        this.remoteTimer = null;

        this.localGifsCache = null;
        this.remoteGifs = {};
        this.previews.clear();
    }


    public getFolderPreviewGifs(folders?: FolderMap) {
        const categories: TrendingCategory[] = [];
        for (const folder of Object.values(folders ?? {}).sort((a, b) => a.idx - b.idx)) {
            const preview = this.previews.get(folder.idx);
            categories.push({
                name: folder.name,
                type: "Favorites",
                src: preview?.src ?? "",
                format: preview?.format ?? 1,
            });
        }
        return categories;
    }

    public getPreview(idx: number) {
        return this.previews.get(idx);
    }

    private setPreview(idx: number, preview: FolderPreviewGif) {
        this.previews.set(idx, preview);
    }

    public async setFolderPreviewGifs(gifs?: GifRecord) {
        const allGifs = gifs ?? await this.getAllLocalGifs();
        if (!allGifs) return;

        this.previews.clear();

        const seen = new Set<number>();
        for (const gif of Object.values(allGifs)) {
            const folderIdx = Math.floor(gif.order / DEFAULT_FOLDER_STEP);

            if (seen.has(folderIdx)) continue;
            seen.add(folderIdx);

            this.previews.set(folderIdx, { format: gif.format, src: gif.src });
        }
    }

    public addRemoteGif(gif: RawGif) {
        if (gif.url in this.remoteGifs) return;

        const { url, ...rest } = gif;
        const order = Object.values(this.remoteGifs).reduce((h, g) => Math.max(h, g.order), 0) + 1;
        this.remoteGifs[url] = { ...rest, order };

        this.scheduleRemoteFlush();

        this.logger?.info("Adding remote gif: ", gif);
    }

    public deleteRemoteGif(rawGif: RawGif) {
        if (!(rawGif.url in this.remoteGifs)) return;

        delete this.remoteGifs[rawGif.url];
        this.scheduleRemoteFlush();

        this.logger?.info("Deleting remote gif: ", rawGif)
    }

    public async showRemoteGifs() {
        await this.dispatchGifs(this.remoteGifs);
    }

    // patch endpoint is rate limited pretty annoyingly
    private scheduleRemoteFlush() {
        if (this.remoteTimer) clearTimeout(this.remoteTimer);
        this.remoteTimer = setTimeout(() => this.flushRemoteGifs(), 3000);
    }

    public async flushRemoteGifs() {
        this.remoteTimer = null;

        const proto = this.generateProtoFromGifs(this.remoteGifs);

        // updateAsync does a local update that causes an extra flicker, so we call markDirty instead.
        FrecencyAC.markDirty(proto, { delaySeconds: 0, dispatch: false });

        await this.dispatchGifs(this.remoteGifs);
    }

    // Need to use the RestApi because FrecencyAC.getCurrentValue()
    // return the local array of gifs (affected by flux)
    public async getAllRemoteGifs(): Promise<GifRecord | undefined> {
        const { ok, status, body } = await RestAPI.get({
            url: "/users/@me/settings-proto/2",
        });
        if (!ok || status !== 200 || !body?.settings) return undefined;

        const bytes = Uint8Array.from(atob(body.settings), c => c.charCodeAt(0));
        const end = FrecencyAC.ProtoClass.fromBinary(bytes, BINARY_READ_OPTIONS);

        if (!end.favoriteGifs || !end.favoriteGifs.gifs) return undefined;

        return end.favoriteGifs.gifs;
    }

    public async syncRemoteGifs(protoGifs?: GifRecord) {
        const discordGifs = protoGifs ?? await this.getAllRemoteGifs();
        if (!discordGifs) return;

        const next: GifRecord = {};
        for (const [url, value] of Object.entries(discordGifs)) {
            const cleaned = this.cleanGif({ ...value, url });
            if (!cleaned.url) continue;
            next[cleaned.url] = value;
        }

        this.remoteGifs = next;
    }

    public async addLocalGif(folder: Folder, rawGif: RawGif) {
        const allGifs = await this.getAllLocalGifs();
        if (!allGifs) return undefined;

        const { url, ...rest } = rawGif;
        const nextOrder = this.getNextOrderForGif(folder, allGifs);
        allGifs[url] = { ...rest, order: nextOrder };

        await this.updateLocalGifs(allGifs);
        this.refreshLocalStaleGifs();

        this.setPreview(folder.idx, { src: rest.src, format: rest.format });

        return allGifs;
    }

    public async deleteLocalGif(rawGif: RawGif) {
        const allGifs = await this.getAllLocalGifs();
        if (allGifs && rawGif.url in allGifs) {
            delete allGifs[rawGif.url];
            await this.updateLocalGifs(allGifs);
        }

        await this.setFolderPreviewGifs(allGifs);

        this.logger?.info("Deleted local gif: ", allGifs);
        return allGifs;


    }

    public async getAllLocalGifs() {
        if (this.localGifsCache) return this.localGifsCache;

        const key = this.getKey();
        if (!key) return;

        this.localGifsCache = await DataStore.get(key) ?? {};
        return this.localGifsCache;
    }

    public async syncLocalGifs(protoGifs: GifRecord) {
        const storedGifs = await this.getAllLocalGifs();
        if (!storedGifs) return;

        for (const [url, value] of Object.entries(protoGifs)) {
            const cleaned = this.cleanGif({ ...value, url });
            if (!cleaned.url || !(cleaned.url in storedGifs)) continue;

            if (storedGifs[cleaned.url].src !== value.src) {
                storedGifs[cleaned.url].src = value.src;
            }
        }

        await this.updateLocalGifs(storedGifs);
    }

    private async updateLocalGifs(gifs: GifRecord) {
        if (this.localGifsCache) return this.localGifsCache;

        const key = this.getKey();
        if (!key) return;

        await DataStore.set(key, gifs);
        this.localGifsCache = gifs;

        this.logger?.info("Updating local gifs with: ", gifs);
    }

    private getNextOrderForGif(folder: Folder, allGifs: GifRecord): number {
        const max = Object.values(allGifs)
            .filter(g => g.order >= folder.start && g.order < folder.end)
            .reduce((h, g) => Math.max(h, g.order), folder.start - 1);

        if (max >= folder.end - 1) {
            throw new Error(`Folder ${folder.name} is full`);
        }

        return max + 1;
    }


    public getFolderGifs(gifs: GifRecord, folder: Folder) {
        const result: GifRecord = {};
        for (const [url, gif] of Object.entries(gifs)) {
            if (gif.order >= folder.start && gif.order < folder.end) {
                result[url] = gif;
            }
        }

        return result;
    }

    async showFolderGifs(folder: Folder) {
        const allGifs = await this.getAllLocalGifs();
        if (!allGifs) return;

        const filtered = this.getFolderGifs(allGifs, folder);
        await this.dispatchGifs(filtered);
    }

    private async dispatchGifs(gifs: GifRecord) {
        const proto = this.generateProtoFromGifs(gifs);
        await FluxDispatcher.dispatch({
            type: "USER_SETTINGS_PROTO_UPDATE",
            local: true,
            partial: true,
            settings: { type: 2, proto },
        });

        this.logger?.info("Dispatched the following gifs: ", gifs);
    }

    // gifs we grab have an expiry date of 24h
    // discord automatically refreshes the one held in remote, but we also need to update local ones
    async refreshLocalStaleGifs() {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);

        const localGifs = await this.getAllLocalGifs();
        if (!localGifs) return;

        let msTillNextRefresh = NEXT_DAY_MS;
        for (const gif of Object.values(localGifs)) {
            const parsedUrl = parseUrl(gif.src);
            if (!parsedUrl || parsedUrl.hostname !== "media.discordapp.net") continue;

            const ex = parsedUrl.searchParams.get("ex");
            if (!ex) continue;

            const epochSecondsEx = parseInt(ex, 16);
            const msTillExpiry = epochSecondsEx * 1000 - Date.now();
            msTillNextRefresh = Math.min(msTillExpiry, msTillNextRefresh);
        }

        if (msTillNextRefresh < 0) {
            const refreshed = await this.refreshSrcs(localGifs);
            await this.updateLocalGifs(refreshed);
            msTillNextRefresh = NEXT_DAY_MS;
        }

        this.refreshTimer = setTimeout(
            () => void this.refreshLocalStaleGifs(),
            Math.max(msTillNextRefresh, 30_000),
        );

        this.logger?.info("Setting next stale refresh timer at: ", Math.max(msTillNextRefresh, 30_000));
    }

    private async refreshSrcs(gifs: GifRecord): Promise<GifRecord> {
        const srcToKey = new Map<string, string>();
        for (const [key, gif] of Object.entries(gifs)) {
            srcToKey.set(gif.src, key);
        }

        const srcs = Array.from(srcToKey.keys());
        const result: GifRecord = { ...gifs };

        // the endpoint allows up to 50 url's at once, so this has to be batched
        for (let i = 0; i < srcs.length; i += 50) {
            const chunk = srcs.slice(i, i + 50);

            const { ok, body } = await RestAPI.post({
                url: "/attachments/refresh-urls",
                body: { attachment_urls: chunk },
            });
            if (!ok || !body?.refreshed_urls) continue;

            for (const { original, refreshed } of body.refreshed_urls) {
                const key = srcToKey.get(original);
                if (key) result[key] = { ...result[key], src: refreshed };
            }
        }

        return result;
    }

    private getKey() {
        const id = UserStore?.getCurrentUser()?.id;
        if (!id) {
            return undefined;
        }

        return `GifFolders:gif:${id}`;
    }

    private generateProtoFromGifs(gifs: GifRecord) {
        const proto = FrecencyAC.ProtoClass.create();
        proto.favoriteGifs = FavoriteAC.create({ gifs });
        return proto;
    }


    private cleanGif(gif: RawGif): RawGif {
        return { ...gif, url: gif.url.split("?")[0] };
    }
}

export const gifStore = new GifStore();

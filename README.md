<div align="center"> <h1> GifFolders</h1> </div>

This plugin allows you to organize your favorite gifs into folders that are saved locally!

https://github.com/user-attachments/assets/76d924ef-8538-4673-8e27-0c2b9a821584

# Instructions
This plugin is meant to be used with [Vencord](https://vencord.dev/). Follow the instructions from [here](https://docs.vencord.dev/installing/custom-plugins/).

# Usage
You can add a folder by using the slash command `/AddFolder` and delete one with `/DeleteFolder`. After adding atleast one folder, a menu should appear everytime you try to favorite a gif, showing the avaliable options for that gif.


> [!Tip]
> Both **folders** and **gifs** are saved locally by default. To save a gif remotly, make sure to select `Add to Discord`.

> [!CAUTION]
> There is a possibility of losing your saved gifs by using this plugin, follow the `Creating a backup` section to create a backup if you want to avoid that risk!

# Flow

# Creating a backup
### Saving
Assuming you have access to devtools inside of Vencord, you can run the following code inside of console to grab a copy of your gifs:
```js
copy(JSON.stringify(UserSettingsActionCreators.FrecencyUserSettingsActionCreators.getCurrentValue()?.favoriteGifs?.gifs));
```
You should save the output somewhere to not lose it.

<details>
<summary>Non-Vencord version</summary>

```js
let _mods = webpackChunkdiscord_app.push([[Symbol()], {}, e => e.c]);
webpackChunkdiscord_app.pop();

let find = f => {
    for (let m of Object.values(_mods)) {
        let e = m?.exports;
        if (!e || e === window) continue;
        if (f(e)) return e;
        for (let k in e) {
            if (e[k] && f(e[k])) return e[k];
        }
    }
};

const FrecencyAC = find(m => m?.ProtoClass?.typeName?.endsWith(".FrecencyUserSettings"));
console.log(FrecencyAC.getCurrentValue()?.favoriteGifs?.gifs);
```
</details>
<hr />

### Restoring
If you followed the saving steps, you should have a JSON string containing your gifs. Open devtools and run the following:
```js
gifs = <YOUR JSON STRING>
await UserSettingsActionCreators.FrecencyUserSettingsActionCreators.updateAsync("favoriteGifs", data => {
    data.gifs = gifs;
}, 0);

```
Now your old discord gifs should have replaced your current ones.
<details>
<summary>Non-Vencord version</summary>

```js
...
```
</details>

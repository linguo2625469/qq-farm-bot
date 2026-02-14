# 如何使用[Reqable](https://reqable.com/zh-CN/download/)进行抓包

**设备环境：Android/IOS & Windows**
> 注意：在抓包时，应当保证双端处于同一网络环境下，且设备环境内没有开启代理软件（例如clash），有必要时，请手动清空当前 `系统代理` 或 `VPN设置`

## QQ

### 1.分别在设备上下载对应的Reqable应用

Windows：[x86_64](https://app.reqable.com/download?platform=windows&arch=x86_64&ext=exe&locale=zh-CN)(支持 Windows 7+)

Android：[arm64](https://app.reqable.com/download?platform=android&arch=arm64&ext=apk&locale=zh-CN)(要求Android 5.0及以上系统版本)

iOS：[App Store](https://apps.apple.com/app/id6473166828)(要求iOS 12.0及以上系统版本)

### 2.配置 SSL & CA 证书

> 注，Android这里针对无法root的机型

#### Windows

- 打开Windows端软件，点击顶部操作栏中的`盾牌图标`，并点击`现在安装` <br>
  详细教程可参考[Reqable Docs](https://reqable.com/zh-CN/docs/getting-started/installation/#desktop)

- Windows端安装完毕后，点击下方 `安装到其他设备或应用程序 - Android` ，点击 `用户证书 - 查看指引`，接着点击**左下角下载按钮**，并且把下载下来的证书存放到任意一个你能找得到的地方

#### Android

- 打开你的手机，把刚刚在电脑上下载的证书**从电脑发送到手机上**并**存放在一个你能找得到的地方**，可以直接使用QQ或者微信等软件 <br>
  打开手机 `设置 -> 安全 -> (更多安全设置) -> 加密与凭据 -> 安装证书(从存储设备安装) -> CA证书` ，选择导出的证书并安装 <br>
  (这里的路径可能不尽相同，可以上网搜索得到本机系统的具体设置位置)

- 打开Android端软件，进入 `左上角三杠 -> 证书管理` ，查看上方的 `安装根目录到本机` 下方，如果刚刚的步骤没有错误的话，此时应当显示 `! 证书已安装到用户目录`

#### IOS

- 参考Reqable的[官方教程](https://reqable.com/zh-CN/docs/getting-started/installation/#ios)

### 3.开始监听及抓包

#### 绑定设备

- Windows：点击顶部操作栏中左侧的的`手机图标(手机协同设置)`，并获取二维码
- 手机侧：打开软件，进入 `左上角三杠 -> 远程设备 -> 右上角+号 -> 扫描二维码` ，然后扫描电脑上的二维码，此时手机端应显示 `设备已连接`

#### 开始监听

- 在手机端中进行如下步骤 `右上角三点 -> 应用程序 -> 右上角+号 -> 输入QQ并选中`
- 然后将右下角`断掉的小飞机`打开
- 接着启动电脑端的`调试`
- 此时手机打开qq后，电脑端会弹出网络请求信息，在这里先选中`Websocket`这一栏
- 然后打开`QQ经典农场`，可观察到电脑端弹出一条调试信息，双击打开并选择 `参数` 可见以下信息 <br>

| platform | qq |
|  ----  | ----  |
| os | Android |
| ver | 1.6.0.12_20251224 |
| code | 这里就是我们想要的 |
| openID | *貌似是空的* |

## 微信

下载软件并配置的过程如上参考，仅在监听时有区别

### 3.开始监听及抓包

> 待补充

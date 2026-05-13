# 国外硬件取证设备深度调研

> **写作时间**：2026-05-13
> **读者**：国内大型互联网公司数据安全 / 取证工程师
> **视角**：企业自用 + 个人能力升级，不写司法 / 法庭证据
> **范围**：硬件 Imager / Write Blocker / 取证工作站。**不包括**：移动端取证（Cellebrite / GrayKey）、纯软件套件、EDR

---

## 一、执行摘要

硬件取证的核心心智模型可以浓缩成一句话：**Imager 是采血针，Write Blocker 是保险栓，Workstation 是手术台**。三者分工：

1. **Standalone Imager**（独立镜像设备）：脱离 PC，自带 OS 和 hashing 引擎，直接把"被检盘"按位拷贝到"证据盘"或 E01 镜像文件。**核心价值是速度 + 离线性 + 一致的镜像格式**。代表玩家：OpenText Tableau TX1/TX2、Logicube Falcon-NEO2、Atola TaskForce 2。
2. **Write Blocker**（写保护器）：物理阻断对被检盘的任何写操作，是所有"接 PC 看盘"场景的前置硬件。**核心价值是可法证认的隔离层**。代表玩家：OpenText Tableau Bridge 系列、CRU WiebeTech UltraDock / ComboDock。
3. **Forensic Workstation**（取证工作站）：跑 EnCase / FTK / X-Ways / Axiom 的高配 PC，关键是 ECC RAM + 多盘位 + 集成 Write Blocker 抽拉盒 + 长保修。代表玩家：Digital Intelligence FRED、Sumuri TALINO、Forensic Computers EDAS FOX。

**选型核心判断**：

- **Imager 选型轴**：单点速度（Logicube 100+ GB/min 单源最快）vs 并发吞吐（Atola TaskForce 2 25 TB/hour，26 端口并行）vs 兼容广度（Tableau TX1/TX2 接口最全 + 老盘最稳）。
- **Write Blocker 选型轴**：基本看接口（NVMe / SAS / FireWire 取舍）+ 是否需要 DIP 切换 R/W 模式（CRU FCDv6 有，FUDv6 永久只读）。
- **Workstation 选型轴**：买现成（3 年保 + lifetime support，省运维）vs DIY（同价位拿 50-70% 算力，但失去 forensic-grade 的预集成 WriteBlocker 抽拉盒和保修兜底）。

**为什么是这 9-10 家**：硬件取证全球市场就是这个生态——Imager 头部三家（Tableau、Logicube、Atola）+ 中端两家（CRU WiebeTech、第三方 Logicube ZXi），Workstation 头部三家（FRED、TALINO、Forensic Computers），Write Blocker 头部两家（Tableau Bridge、CRU UltraDock）+ 部分国产 / 印度小厂（不入选）。本报告**有意省略**了移动端取证硬件（Cellebrite UFED、GrayKey、MSAB XRY、Magnet GRAYKEY）——它们属于"手机 / 移动设备物理取证"独立赛道，与传统盘镜像设备的硬件设计、协议栈、保管链都不同，按用户范围明确剔除。

---

## 二、硬件取证小百科

### 1. 软件 Write Blocker vs 硬件 Write Blocker 的真实差别

软件 Write Blocker（如 Linux `mount -o ro`、Windows 注册表 `WriteProtect`）在 SATA 控制器层之上拦截写命令。理论上可靠，但 **运行在被检 OS 同一栈** 上：任何驱动 bug、内核 panic、注册表脏写、Auto-Mount 服务竞争都可能在 1 秒级窗口里漏写——这 1 秒里 Windows 会写入 `$Recycle.Bin/desktop.ini`、`System Volume Information/`、调整 Last Access Time。硬件 Write Blocker 在物理层（USB-to-SATA bridge IC）阻断 SCSI Write 命令，**任何写都是协议层 NAK**，物理上做不到。

业界默认共识：**司法 / 高 stakes 调查必须用硬件 blocker**（NIST CFTT 把所有 hardware blocker 单独立项测试，软件 blocker 默认不入合规清单）。但企业内部 IR / 漏洞响应、二线取证用软件 blocker（甚至 `dd if=/dev/sdX`）现实可以接受——前提是流程文档写清楚"非司法用途"。

[Hardware Write Block - NIST](https://www.nist.gov/itl/ssd/software-quality-group/computer-forensics-tool-testing-program-cftt/cftt-technical/hardware) · [Essential Guide to Write Blockers - SalvationData](https://www.salvationdata.com/knowledge/write-blocker/)

### 2. HPA / DCO 是什么 + 哪些 Imager 能绕过

**HPA（Host Protected Area）** 和 **DCO（Device Configuration Overlay）** 是 ATA-4/ATA-6 引入的"机制性隐藏区"。HPA 让厂商把 OEM 恢复分区藏在普通 `IDENTIFY_DEVICE` 看不到的尾部；DCO 更狠，可以把一块 1TB 盘伪装成 750GB（甚至改 features bitmap）。

**问题**：用户级工具（hdparm 不带 `-N`、Windows 磁盘管理）只看到"假大小"，标准镜像会**漏掉这部分**。

**能检测 + 解除（unclip）的硬件 Imager**：

- **Atola Insight Forensic / TaskForce 2**：明确支持 HPA / DCO / AMA 三种限制的 detect / unclip / 临时修改。
- **OpenText Tableau TX1 / TX2 / TD4**：支持 HPA / DCO 检测和移除。
- **CRU WiebeTech UltraDock FUDv6**：可在 LCD 菜单里 detect / remove / modify HPA / DCO / AMA。
- **Logicube Falcon-NEO2**：支持 HPA / DCO 检测和镜像。

NVMe SSD **没有传统意义上的 HPA / DCO**——namespace 控制器层做了等价封装（Namespace Management、Endurance Group），需要不同的 admin command（`Identify Namespace`、`Get Features`）来探测隐藏 namespace。

[Wikipedia - Device configuration overlay](https://en.wikipedia.org/wiki/Device_configuration_overlay) · [Atola TaskForce 2 HPA/DCO unclip](https://atola.com/products/taskforce/manual/unclip.html) · [OSForensics - Hidden Disk Areas](https://www.osforensics.com/hidden-areas-hpa-dco.html)

### 3. NVMe SSD 取证的特殊性：物理镜像意义有限

NVMe SSD 物理镜像的"完整性"幻觉来自三个机制：

- **TRIM / Deallocate**：OS 删文件时发 `Dataset Management - Deallocate` 命令，告诉 SSD"这些 LBA 我不要了"。SSD 控制器在 background 把对应 NAND 块 erase。**关键**：现代 NVMe 控制器默认实现 **DZAT（Deterministic Read Zero after TRIM）**——TRIM 完之后任何对这些 LBA 的读返回全 0，**即使 NAND 物理上还没擦**。物理镜像拿到的就是 0。
- **Wear Leveling**：写放大让"逻辑 LBA → 物理 NAND block"映射动态变化。删除的文件碎片可能散落在任意 NAND block，文件 carving 几乎无效。
- **Garbage Collection（GC）**：后台异步擦除，时间不可预测。被检盘上电那一刻 GC 可能开始抹掉证据。

**实务建议**：

1. NVMe 取证**优先做 logical 镜像**（文件系统级 + 已挂载 volume 内的现存文件 + 未分配 metadata），物理镜像作为补充而不是主体。
2. 上电前用 Write Blocker（必须支持 NVMe / PCIe，如 Tableau TX1 + PCIe 适配器、CRU FUDv6 + PCIe 模块）。
3. 真的需要 NAND 级 → 走 **chip-off** 路径（拆 NAND 用编程器读，绕开控制器），但这是 hardware lab 级活儿，不在企业 IR 范围。

[ElcomSoft - TRIM, DRAT, DZAT for SSD Forensics](https://blog.elcomsoft.com/2025/06/what-trim-drat-and-dzat-really-mean-for-ssd-forensics/) · [Rossmann Group - TRIM & GC](https://rossmanngroup.com/services/ssd-data-recovery/trim-garbage-collection)

### 4. SMR 盘 / SSD 不可恢复区：硬件 Imager 也救不了

**SMR（Shingled Magnetic Recording）** 是为了堆容量发明的——磁道像屋顶瓦片重叠铺。问题：

- **写一个磁道会覆盖相邻磁道**，所以盘内固件维护一个"persistent cache zone + main shingled zone + translation layer"，物理布局和逻辑 LBA 之间隔着两层映射。
- **覆写后的数据无法用常规 carving 找回**——重叠覆盖摧毁了磁化痕迹。
- **断电时若 GC 正在 cache → shingled 迁移过程中**，恢复的数据可能介于 staged 和 final 之间，需要特殊 firmware 知识（PC-3000 才能搞）。

**结论**：SMR 盘的"deleted but recoverable"窗口比 CMR 盘窄很多，且 NIST 800-88 标准的覆写擦除在 SMR 上**并不可靠**（BitRaser 测试发现覆写后仍可恢复部分图像）——既是反取证的弱点，也是取证的不确定性。

[Rossmann Group - CMR vs SMR](https://rossmanngroup.com/technical-reference/cmr-vs-smr-hard-drives) · [Data Recovery - SMR Drives Recovery Challenges](https://www.datarecovery.co.za/tech-blog/unique-challenges-when-recovering-data-from-formatted-wd-smr-drives.html)

### 5. 镜像格式速览

| 格式 | 全称 | 压缩 | 加密 | 主流支持 |
|------|------|------|------|---------|
| **dd / raw** | bit-for-bit | 否 | 否 | 全部工具 |
| **E01 / Ex01** | Expert Witness Format（EnCase） | 是（gzip） | E01 否 / Ex01 AES-256 | EnCase / FTK / X-Ways / Autopsy / 所有商业 Imager |
| **AFF / AFF4** | Advanced Forensic Format | 是 | AES-256 | 开源主导（pyAFF4），Logicube Falcon-NEO2 原生支持 |
| **DMG** | Apple Disk Image | 是 | AES-128/256 | macOS 取证 |
| **S01** | SMART format（ASR Data） | 是 | 否 | 老工具，已不常见 |

**实务**：企业内部跨工具协作优先 **E01**（事实标准），需要加密保护证据链时用 **Ex01**（带 AES-256）。AFF4 在云 / VM 镜像场景更优（支持 sparse、stream）。

---

## 三、类别 1：硬件镜像设备（Standalone Imager）对比

### 横向对比表

| 产品 | 厂商 | 最大单源速度 | 并发 | 接口 | 镜像格式 | HPA/DCO | 加密镜像 | 参考价（USD） |
|------|------|------|------|------|------|------|------|------|
| **Tableau TX1** | OpenText | ~50 GB/min（SHA-1+E01） | 2 jobs / 1:4 | SATA/SAS/USB3/FireWire/PCIe（adapter）/IDE | E01/Ex01/DD/DMG | 是 | Ex01 AES-256 | ~$5,000-$7,000（已被 TX2 取代，按 distributor 报价） |
| **Tableau TX2** | OpenText | ~50+ GB/min（带 Parallel Hash） | 2+ jobs / 1:4 | SATA(2)/SAS/USB-C(2)/PCIe(2)/Network | E01/Ex01/DD/DMG | 是 | Ex01 AES-256 + YubiKey MFA | ~$6,000-$8,000（pre-order）|
| **Tableau TD4** | OpenText | ~15-25 GB/min（estimate） | 1 job / 1:5 | SATA/SAS/USB-C/PCIe | E01/Ex01/DD | 是 | Ex01 AES-256 | ~$3,000-$4,500 |
| **Logicube Falcon-NEO2** | Logicube | **115 GB/min**（SSD→SSD，E01+verify on） | 5 tasks / 10 源 11 目 | SATA/SAS-3(12Gbps)/USB 3.2 Gen2/NVMe/PCIe/10GbE | E01/Ex01/DD/AFF4 | 是 | AES-256 | ~$8,000-$10,000 |
| **Atola TaskForce 2** | Atola | **25 TB/hour 累计**（25+ 并行）| 25+ jobs | SATA/SAS/NVMe M.2/U.2 PCIe 4.0/USB/IDE | E01/Ex01/DD | 是 | AES-256 + RAID 0/1/5/6/10 | ~$20,000-$25,000（含 lifetime warranty）|
| **Atola Insight Forensic** | Atola | 500 MB/s 单 session（~30 GB/min） | 3 sessions | SATA/IDE/USB + 扩展 PCIe/NVMe/Apple PCIe | E01/Ex01/DD | 是 | AES-256 | ~$10,000-$15,000 |
| **Logicube ZXi-Forensic** | Logicube | 50+ GB/min | 5 targets 扩展 9 | SATA/SAS/USB3 | E01/DD | 是 | AES-256 | **$8,044.67**（Zoro 实价） |
| **WiebeTech Ditto DX FieldStation** | CRU | ~6-8 GB/min | 1 source / 多 dest | SATA/eSATA/PATA/USB3/GbE + NVMe via 扩展 | DD/E01/L01 | 部分 | AES-256 OPAL | ~$3,500-$5,000 |

### 厂商深度卡片

#### A. OpenText Tableau TX1 / TX2（行业事实标准）

OpenText 收购 Guidance Software（EnCase 母公司，原 Tableau 品牌）后，Tableau 成为**全球公检法和企业取证团队最高保有量的 Imager**。TX1 提供 IDE/SATA/SAS/USB3/FireWire 写保护与镜像，10 GbE 网络口可以镜像到 CIFS/iSCSI 网络存储，**支持 2 个并发 job + 单源 4 目标**。镜像格式 E01/Ex01/DD/DMG 全覆盖，Ex01 自带 AES-256 加密。TX1 在 2024 年开始被 TX2 取代——TX2 改用 Intel Xeon-D 服务器级平台，新增 **Parallel Hash Verification**（同时算多种 hash 不增加 readback 时间）、**Tree Hashing**（大规模并行）、**YubiKey 多因素认证**。注意 TX2 的 PCIe lane 配置与 TX1 不兼容，老 adapter 需要换新 TA7-x 系列。胜在生态最广，**EnCase / FTK / X-Ways 都把 TX1/TX2 当一等公民支持**。

[Tableau TX1 - OpenText](https://www.opentext.com/products/tableau-tx1-forensic-imager) · [Tableau TX1 Datasheet PDF](https://www.opentext.com/assets/documents/en-US/pdf/opentext-po-tableau-tx1-en.pdf) · [Tableau TX2 - Digital Intelligence](https://digitalintelligence.com/store/products/d6400)

#### B. Logicube Falcon-NEO2（单点速度王）

Logicube 是 Tableau 之外的另一家美国老牌。**Falcon-NEO2 的核心卖点是单源速度**：SSD-to-SSD E01 镜像 **115 GB/min**，PCIe-to-PCIe clone **100+ GB/min**——是第一台突破 100 GB/min E01 大关的现场 Imager。SAS-3（12 Gbps）架构支持 **10 源 + 11 目** 同时跑 **5 个任务**。机身仅 1.52kg + 10″×6.75″×3.25″，**便携性碾压机柜级方案**。USB 3.2 Gen-2 (10 Gbps) + 双 10 GbE 网络口。**注意**：厂商 115 GB/min 数字是基于 SAS-3 SSD + 新 OS + 随机数据 + E01 压缩开 + verify 开测出来的，HDD 实测大幅下降。原生支持 **AFF4**（云时代镜像格式），Cloud Storage Acquisition 和 Mobile Device Capture 是标配（不像 TX1 要额外许可）。**便携 + 速度**是其杀手锏，但兼容广度略输 Tableau。

[Falcon-NEO2 Product Page - Logicube](https://www.logicube.com/shop/forensic-falcon-neo2/) · [Falcon-NEO2 Practitioner Review PDF](https://assets.ctfassets.net/vx3rk3elm501/OIT1Vvo8jddZBTkQdpiBQ/508a6fc6b336929030116bdcc3519702/Logicube_Falcon-NEO2_Review-Zeke_Thackray_Sept_2023_2023.pdf)

#### C. Atola TaskForce 2（并发吞吐王 + 坏盘恢复）

Atola 是匹"突变种"——本来是数据恢复（PC-3000 的竞品）出身，往取证延伸。**TaskForce 2 不走"小而美"路线，直接做了 26 端口的 3U 机柜单元**：16-core Xeon CPU + 16 GB ECC RAM，**25 TB/hour 累计吞吐**（25+ 并行 imaging session），**单源极限其实和 Falcon-NEO2 差不多，但能同时跑 25 块盘**——企业大批量入库场景碾压。最大差异化：**多 pass imaging 算法专门为坏盘 / 不稳定盘设计**。preset 模式 5 pass、第一 pass jump 100 万扇区跳过 bad sector、最后 pass jump 1 扇区精扫，配合不同 block size（4096 / 256）应对不同损坏类型。**自带 RAID 0/1/5/6/10 重建**，被检盘是 RAID 阵列时可以原位重组。**单价 $20k+ 但带 lifetime warranty**——同期 Tableau / Logicube 都只给 3 年保。

[Atola TaskForce 2](https://atola.com/products/taskforce/) · [TaskForce 2 multipass imaging](https://atola.com/products/taskforce/manual/multipass-imaging.html) · [TaskForce 2 hardware](https://atola.com/products/taskforce/manual/hardware.html)

#### D. CRU WiebeTech Ditto DX FieldStation（中端便携）

CRU（前身 WiebeTech）是 Imager 二线但 Write Blocker 一线。Ditto DX 定位是 Tableau TX1 的低价替代品：**双 USB3 + 双 eSATA + 双 GbE 目标口**（一个 GbE 还给 GUI 访问）+ 模块化扩展（SAS Module / FireWire Module / Network Tap Module）。**支持 NVMe 既作为源也作为目标**（NVMe-as-destination 是少见的，多数 Imager 只能 NVMe→SATA）。**Combined Mode** 可以单次读盘同时写 clone + DD 或 E01 到不同目标盘，省一半读盘时间。镜像格式 Clone/DD/E01/L01 + MD5/SHA-1/SHA-256，**OPAL AES-256 整盘加密**。Logical Imaging 是 Ditto 老款两倍。**性价比 + 模块化是卖点**，适合企业第一台 Imager。

[Ditto DX - DigiStor](https://cdsg.com/products/ditto-dx-forensic-fieldstation) · [Ditto DX Datasheet](https://media.dustin.eu/media/d200001004274133/wiebetech-ditto-dx-forensic-fieldstation-document.pdf)

---

## 四、类别 2：Write Blocker 对比

### 横向对比表

| 产品 | 厂商 | 接口（源） | 主机口 | 支持 NVMe/PCIe | 模式 | HPA/DCO | 参考价（USD） |
|------|------|------|------|------|------|------|------|
| **Tableau T356789iu** | OpenText | IDE/SATA(6Gbps)/SAS(6Gbps)/USB 3.0/FireWire 800/PCIe | USB 3.0 | 是（via PCIe adapter） | 永久 WB + DIP 可切 R/W | 是 | ~$1,500-$2,000 |
| **Tableau T6u** | OpenText | SAS / SATA | USB 3.0 | 否 | 永久 WB | 是 | ~$700-$1,000 |
| **Tableau T7u** | OpenText | USB 3.0/2.0/1.0 | USB 3.0 | 否 | 永久 WB | 部分 | ~$300-$500 |
| **Tableau TC-5500** | OpenText | NVMe / PCIe SSD | USB-C 3.2 | 是（原生 NVMe） | 永久 WB | 是 | ~$1,200-$1,800 |
| **CRU WiebeTech UltraDock FUDv6** | CRU | IDE/PATA/SATA（+ adapter 扩 NVMe/PCIe） | USB 3.2 Gen 2 / USB-C | 是（via adapter） | **永久 WB**（防误开） | 是（LCD 菜单可操作）| **$433-$444**（Walmart/SHI 实价） |
| **CRU WiebeTech ComboDock FCDv6** | CRU | IDE/PATA/SATA | USB 3.2 Gen 2 | 否 | **双模式**（开机选 WB 或 R/W） | 是 | ~$500-$600 |

### 厂商深度卡片

#### E. OpenText Tableau Forensic Bridge 系列（旗舰 + 内置）

Tableau Bridge 是 **Forensic Workstation 5.25″ drive-bay 内置 Write Blocker 的事实标准**——FRED / TALINO 工作站的 UltraBay 抽拉盒里几乎清一色的 Tableau Bridge。**T356789iu（Universal Bridge）**：6 种媒体类型——IDE/SATA(6Gbps Gen3)/SAS(6Gbps Gen2)/USB 3.0/FireWire 800/PCIe，**R2 版本用了 custom SAS host controller，SAS/SATA 性能比老 Combo Bridge 提升 300%**。**关键设计**：内置 DIP switch 可以切换到 R/W 模式（用于擦盘 / 准备目标盘），不是永久写保护——所以使用流程必须强制"先确认 DIP 在 WB 位"。**TC-5500** 是新一代 USB-C 接口的 NVMe / PCIe 专用 blocker，对 M.2 NVMe SSD 取证场景是必备。Tableau Bridge 通过 NIST CFTT 测试（DHS 公开测试报告），适合追求合规和工具链一致性的场景。

[Tableau Universal Bridge T356789iu Integration Guide](https://www.opentext.com/assets/documents/en-US/pdf/opentext-ig-tableau-forensic-universal-bridge-t356789iu-en.pdf) · [NIST T356789IU Test Report](https://www.dhs.gov/sites/default/files/publications/Test%20Report_NIST_HWB_Tableau%20Forensic%20Universal%20Bridge%20T356789IU_Firmware%20Version%20Apr%2026%202018%2008.49.42_October%202018.pdf)

#### F. CRU WiebeTech UltraDock / ComboDock（性价比 + 防误操作）

CRU UltraDock 和 ComboDock 是**桌面式独立 Write Blocker 的事实标准**，Tableau 同价位略贵。两个产品的核心差异是**模式设计哲学**：

- **UltraDock FUDv6（$433）**：**永久写保护，物理上不能切换 R/W**。开机即写保护，没有"忘记打开 WB"的可能性。LCD 菜单可以 detect / remove / modify HPA / DCO / AMA。USB-C orientation-free 接口。**适合一线一线 IR 工程师用**（怕新人误操作）。
- **ComboDock FCDv6（~$500-$600）**：**开机时弹菜单问"WB 还是 R/W"**，二选一。灵活但有人为风险。**适合资深取证师 + 实验室双用场景**（同一台设备早上接被检盘做镜像，下午接目标盘格式化）。

接口都是 IDE/PATA/SATA 原生，NVMe/PCIe 通过 adapter 扩展。**3 年保修 + 美国本土制造**，企业采购友好。

[CRU UltraDock FUDv6 - CRU-inc](https://www.cru-inc.com/products/wiebetech/wiebetech_forensic_ultradock_v5/) · [WiebeTech FUDv6 Datasheet PDF](https://media.dustin.eu/media/d200001004274113/wiebetech-forensic-ultradock-v55-document.pdf)

---

## 五、类别 3：取证工作站（Forensic Workstation）对比

### 横向对比表

| 产品 | 厂商 | CPU | RAM | 内置 WB | 保修 | 入门价（USD） |
|------|------|------|------|------|------|------|
| **FRED 1R**（1 RAID）| Digital Intelligence | Intel i9 / Xeon / AMD Threadripper PRO 7900 | 64-128 GB DDR5 | UltraBay 4d（SATA/IDE/SAS/USB3/FW/PCIe）+ Ventilated Imaging Shelf | **36 个月 + lifetime tech support** | ~$10,599 |
| **FRED-L 笔记本** | Digital Intelligence | Intel Ultra 9 275HX 24-core | 64 GB DDR5 | UltraKit（外置 SATA/IDE/USB/PCIe blocker） | 36 个月 | ~$6,500-$8,000（估算） |
| **FRED X** | Digital Intelligence | Intel Xeon | 128+ GB | UltraBay 4d | 36 个月 + lifetime | $10,499 起 |
| **FRED AMD** | Digital Intelligence | AMD Threadripper PRO 7900 series + WRX90 | 高配 | UltraBay 4d | 36 个月 + lifetime | $7,749 起 |
| **TALINO KA-Ultra** | Sumuri | Intel Core Ultra Series 2 | 中等 | 模块化 | 3 年 + lifetime support | **$3,299** |
| **TALINO KA-DESKTOP** | Sumuri | Intel Xeon | 高配 | 集成 | 3 年 | ~$8,000-$12,000 |
| **TALINO NUIX Workstation** | Sumuri | 双 Intel Xeon | 高配 | 集成 | 3 年 | **$23,249** |
| **TALINO Intel Workstation**（顶配）| Sumuri | 双 Intel Xeon | 高配多 GPU | 集成 | 3 年 | **$70,749**（顶配实价） |
| **Forensic Computers Phantym-DX** | Forensic Computers | 双 Intel Xeon Silver 4410Y 12-core | 128 GB DDR5 4000 | UltraBay-equivalent | 3 年 | ~$15,000-$20,000 |

### 厂商深度卡片

#### G. Digital Intelligence FRED 系列（行业老大）

**FRED = Forensic Recovery of Evidence Device**。Digital Intelligence 是 1999 年成立的 forensic-only 公司，FRED 是**第一台商业化 forensic workstation**，事实上**定义了行业 form factor**——前面板大量 5.25″ 抽拉盒、UltraBay 4d 集成 Write Blocker、Ventilated Imaging Shelf 给被检盘散热。FRED 主流型号：

- **FRED（base）$7,749**：AMD Threadripper PRO，单 RAID。
- **FRED 1R $10,599**：单 RAID + i9/Xeon。
- **FRED 2R $11,799**：双 RAID。
- **FRED X $10,499 起**：Xeon 平台，高端配置。
- **FRED-L 笔记本**：现场用，Intel Ultra 9 275HX 24-core / 64 GB DDR5 / 18″ QHD+ 屏 / 预装 Win11 Pro + openSUSE，配 UltraKit 三件套（SATA/IDE blocker + USB3 blocker + PCIe blocker + 媒体卡读卡器）。

**杀手锏是 lifetime tech support**——3 年硬件保 + 终身技术支持，企业用 5-7 年没问题。**缺点是贵 + 升级慢**——FRED 系列的代际更新比消费 PC 慢一年以上。

[FRED 产品页 - Digital Intelligence](https://digitalintelligence.com/products/fred/) · [FRED-L Laptop](https://digitalintelligence.com/products/fred_l) · [FRED X $10,499](https://digitalintelligence.com/store/products/fred-x-forensic-workstation-f1240)

#### H. Sumuri TALINO 系列（价格区间最宽）

Sumuri 是 forensic training + tool 整合商，TALINO 是其自有硬件品牌。**TALINO 是行业里价格区间最宽的取证工作站**——从入门 **KA-Ultra $3,299**（Intel Ultra 系列轻量配置）到 **顶配 Intel Workstation $70,749**（双 Xeon + 多 GPU + 大量 RAID）跨度 20 倍。**TALINO NUIX Workstation $23,249** 是为 Nuix（处理 TB 级 ediscovery 数据的引擎）专门调校的。**所有 TALINO 出厂前 72 小时 burn-in** + 多种 stress test，**3 年保 + lifetime support hotline**。**TAA 合规**（适合美国政府采购）。Sumuri 的另一个优势是**预装 FTK / EnCase / Axiom 全家桶并优化**，到货即用。

**注意**：Sumuri 不对美国境外个人客户直发，需要走 reseller。

[TALINO 产品线 - Sumuri](https://sumuri.com/hardware/forensic-workstations/) · [TALINO Intel Workstation $70,749](https://sumuri.com/product/talino-intel-workstation/) · [TALINO KA-Ultra $3,299](https://talino.tech/product/talino-ka-ultra/)

#### I. Forensic Computers / EDAS FOX（小众但深度集成）

Forensic Computers Inc. 是另一家专业 forensic OEM。主打 **EDAS FOX** 和 **Phantym-DX** 系列。**Phantym-DX** 是 laboratory-grade 配置：**双 Intel Xeon Silver 4410Y 12-core + 128 GB DDR5 4000 MHz Registered Memory**，前面板集成 UltraBay 风格抽拉盒（SATA/IDE/SAS/USB3/FireWire/PCIe 多接口 blocker），用户可选 R/W 或 WB 模式。**适合实验室固定工位**，不主打便携。本身 user-base 比 FRED / TALINO 小，**但客户里有相当数量是美国联邦机构**——胜在深度定制 + 政府关系。**3 年保**。

[Phantym-DX - Forensic Computers](https://www.forensiccomputers.com/phantym-dx) · [EDAS FOX](https://www.edasfox.com/)

### J. DIY 工作站 vs 商业工作站讨论

**DIY 工作站的真实成本**（假设 ~$5,000 预算，企业自购组装）：

- AMD Threadripper PRO 7965WX（24-core）+ WRX90 主板：~$2,500
- 128 GB DDR5 ECC RDIMM：~$700
- 2× NVMe 2TB（OS + 工作区）：~$300
- 4× 8TB HDD（证据存储 RAID）：~$800
- Quadro / RTX 中端 GPU：~$500
- 机箱 + 1000W 电源 + 散热：~$400
- **CRU UltraDock FUDv6 外置 Write Blocker**：~$450
- **小计：~$5,650**

同级别商业 FRED / TALINO 价格在 **$11,000-$13,000**，溢价 100%。

**商业方案的多花的钱买了什么**：

1. **保修 + lifetime support**：3 年硬件 + 终身电话支持。DIY 出问题自己 debug。
2. **预集成 + 预测试**：到货即跑 FTK / EnCase / Axiom 三大件，DIY 自己装可能踩 driver / hyperthreading / ECC 兼容坑。
3. **法证认可性**：审计 / 客户 / 法庭场景，"我们用的是 FRED / TALINO" 比"我们组的"更有说服力。
4. **5.25″ 抽拉盒生态**：UltraBay 4d 内置 Tableau Bridge，**DIY 几乎找不到等价的现成方案**——你可以买 Tableau 卡装到机箱里，但抽拉盒物理设计是 OEM 专利。
5. **TAA / GSA 合规**：政府或大客户合规审查必须项。

**企业自建实验室的合理选择**：

- **基础研发 / 个人能力升级**：DIY 完全 OK，省下来的钱投在 software license（X-Ways / Axiom）+ 培训。
- **入库 + IR 一线工位**：买 1-2 台商业 workstation（如 TALINO KA-DESKTOP），其他用 DIY。
- **司法 / 客户审计场景**：必须商业 workstation + 商业 Imager + 商业 Write Blocker。

[Sumuri - Buying Your First Forensic Workstation](https://sumuri.com/buying-your-first-forensic-workstation-what-actually-matters/) · [Exterro - Building the Perfect Forensic Workstation](https://www.exterro.com/resources/blog/building-the-perfect-forensic-workstation)

---

## 六、企业自建实验室硬件清单（三档）

### 档位 1：入门 / 个人能力 / 小团队（~$5,000-$8,000）

| 项 | 型号 | 价 |
|----|------|----|
| 工作站 | DIY Threadripper PRO 7965WX + 128GB ECC + 2TB NVMe + 4×8TB HDD | $4,500 |
| Write Blocker | CRU WiebeTech UltraDock FUDv6 | $440 |
| Imager（可选）| 暂不买，用 dc3dd / FTK Imager 软件镜像 | $0 |
| 证据存储 | 2× 18TB WD Gold（cold spare） | $700 |
| 网络存储 | Synology DS923+（4-bay）作为长期证据库 | $700 |
| **小计** | | **~$6,340** |
| **月度运营** | 电费 + 软件订阅（X-Ways ~$1,200/年）| **~$200/月** |

**适用场景**：1 个安全工程师 + 偶尔做 IR / 二线取证，每月处理 1-3 起。

---

### 档位 2：中级 / 标准 IR 实验室（~$25,000-$40,000）

| 项 | 型号 | 价 |
|----|------|----|
| 工作站 | Sumuri TALINO KA-DESKTOP 或 Digital Intelligence FRED（base） | $8,000-$10,500 |
| 便携工作站 | Digital Intelligence FRED-L 笔记本（现场用） | $7,000 |
| Standalone Imager | **Logicube Falcon-NEO2** 或 OpenText Tableau TX2 | $8,000-$10,000 |
| Write Blocker | CRU UltraDock FUDv6（×2）+ Tableau TC-5500 NVMe blocker | $440×2 + $1,500 = $2,380 |
| Network Storage | Synology RS1221+（8-bay 80 TB）证据库 | $3,500 |
| 软件 | EnCase + X-Ways + Axiom（各 1 license）| ~$8,000/年 |
| **小计**（硬件） | | **~$28,880-$33,380** |
| **月度运营** | 电费 + 软件 + 备件 | **~$1,200/月** |

**适用场景**：2-4 人专职 IR / 取证小组，每月 5-15 起案件 + 季度大型调查。

---

### 档位 3：完整 / 企业级实验室（~$80,000-$150,000）

| 项 | 型号 | 价 |
|----|------|----|
| 主工作站 | Sumuri TALINO NUIX Workstation（双 Xeon）×2 | $23,249×2 = $46,498 |
| 便携 + 现场 | FRED-L ×2 | $7,000×2 = $14,000 |
| 高速 Imager | **Atola TaskForce 2**（26 端口并行） | $22,000（含 lifetime warranty） |
| 第二 Imager（冗余 / 现场）| Logicube Falcon-NEO2 | $9,000 |
| Write Blocker 全家桶 | Tableau Bridge T356789iu ×2 + TC-5500 ×2 + CRU FUDv6 ×2 | $1,500×2 + $1,500×2 + $440×2 = $6,880 |
| 数据恢复辅助 | Atola Insight Forensic（坏盘救援） | $12,000 |
| Network Storage | Synology HD6500（60-bay）+ 600 TB HDD | $20,000 |
| 软件 | EnCase + X-Ways + Axiom + Cellebrite Inspector + Nuix（site license） | $30,000+/年 |
| 实验室基础设施 | 法拉第袋、屏蔽机柜、双路 UPS、空调、防静电 | $10,000 |
| **小计**（硬件） | | **~$140,000+** |
| **月度运营** | 电费 + 软件 + 备件 + 培训 | **~$5,000-$8,000/月** |

**适用场景**：大型互联网公司专业取证团队（如腾讯安全、阿里安全部门级），每月 20+ 起案件，含**重大事件响应 + 跨地域 IR + 取证流程合规审计**。

---

## 七、总结建议

国内大型互联网公司自建数据安全 / 取证实验室时，硬件采购优先级 **Top 3**：

1. **先买 Write Blocker，再考虑 Imager**：$500-$2,000 的硬件 blocker 是任何取证操作的入门门票。**CRU UltraDock FUDv6（$440，永久 WB 防误操作）+ Tableau TC-5500（NVMe 必备）** 是黄金组合。早期 Imager 可以用 FTK Imager / dc3dd 替代——速度损失但成本归零。
2. **第二步买 Standalone Imager**：当每月案件数 > 5 起或者出现现场 IR 需求时，**Logicube Falcon-NEO2**（便携 + 速度王 + AFF4 原生）或 **OpenText Tableau TX2**（兼容广 + 生态最稳）二选一，单台 $7-10k。**不要一上来就买 Atola TaskForce 2**（$22k），它的 26 端口并发只有大型实验室（每月 20+ 起）才回本。
3. **Workstation 走"1 商 + N DIY"**：买 1 台商业 workstation（Sumuri TALINO KA-DESKTOP $8-10k 性价比最优）作为合规 + 客户展示工位，其他工程师用 DIY Threadripper PRO 工作站（约 $5-6k 一台）。FRED-L 笔记本仅在需要现场 IR 时考虑。

**特别提醒**：

- **国内采购渠道**：Tableau / Logicube / CRU 都有香港 / 新加坡 reseller（如 Hawk Eye Forensic、Disk Drive Solutions、e-Forensic Services），关税 + 增值税在 25-35% 之间，预算要加上。
- **Atola 是俄罗斯背景但欧盟实体**（atola.com 主公司在塞浦路斯），近年地缘紧张需评估供应链风险。
- **国产替代方案**（盘古、美亚、效率源 DC-8800）在司法证据链场景已在国内取代部分进口设备，**但企业内部 IR 场景，国外品牌生态 + 工具链稳定性仍领先**——国产替代主要解决合规和成本问题，能力还在追赶。
- **NVMe 取证能力**是 2024-2026 年最值得 invested 的方向，**TC-5500 + 软件层 NVMe-cli 训练**比再买一台 HDD imager 价值高。

---

## 引用列表（按出现顺序）

1. [Hardware Write Block - NIST CFTT](https://www.nist.gov/itl/ssd/software-quality-group/computer-forensics-tool-testing-program-cftt/cftt-technical/hardware)
2. [Essential Guide to Write Blockers - SalvationData](https://www.salvationdata.com/knowledge/write-blocker/)
3. [Device configuration overlay - Wikipedia](https://en.wikipedia.org/wiki/Device_configuration_overlay)
4. [OSForensics - Hidden Disk Areas HPA/DCO](https://www.osforensics.com/hidden-areas-hpa-dco.html)
5. [Atola TaskForce 2 HPA/DCO unclip manual](https://atola.com/products/taskforce/manual/unclip.html)
6. [ElcomSoft - TRIM, DRAT, DZAT for SSD Forensics](https://blog.elcomsoft.com/2025/06/what-trim-drat-and-dzat-really-mean-for-ssd-forensics/)
7. [Rossmann Group - TRIM & Garbage Collection](https://rossmanngroup.com/services/ssd-data-recovery/trim-garbage-collection)
8. [Rossmann Group - CMR vs SMR](https://rossmanngroup.com/technical-reference/cmr-vs-smr-hard-drives)
9. [DataRecovery.co.za - SMR Drives Recovery Challenges](https://www.datarecovery.co.za/tech-blog/unique-challenges-when-recovering-data-from-formatted-wd-smr-drives.html)
10. [OpenText Tableau TX1 product page](https://www.opentext.com/products/tableau-tx1-forensic-imager)
11. [OpenText Tableau TX1 Datasheet PDF](https://www.opentext.com/assets/documents/en-US/pdf/opentext-po-tableau-tx1-en.pdf)
12. [Tableau TX2 - Digital Intelligence](https://digitalintelligence.com/store/products/d6400)
13. [Logicube Falcon-NEO2 product page](https://www.logicube.com/shop/forensic-falcon-neo2/)
14. [Logicube Falcon-NEO2 Practitioner Review PDF](https://assets.ctfassets.net/vx3rk3elm501/OIT1Vvo8jddZBTkQdpiBQ/508a6fc6b336929030116bdcc3519702/Logicube_Falcon-NEO2_Review-Zeke_Thackray_Sept_2023_2023.pdf)
15. [Atola TaskForce 2 product page](https://atola.com/products/taskforce/)
16. [Atola TaskForce 2 multipass imaging](https://atola.com/products/taskforce/manual/multipass-imaging.html)
17. [Atola Insight Forensic](https://atola.com/products/insight/)
18. [Logicube ZXi-Forensic - Zoro price $8,044.67](https://www.zoro.com/logicube-inc-zxi-forensic-sassatausb3-forensic-imager-w-multi-source-f-zxi-forensic/i/G6056938/)
19. [WiebeTech Ditto DX FieldStation - DigiStor](https://cdsg.com/products/ditto-dx-forensic-fieldstation)
20. [WiebeTech Ditto DX Datasheet PDF](https://media.dustin.eu/media/d200001004274133/wiebetech-ditto-dx-forensic-fieldstation-document.pdf)
21. [Tableau Universal Bridge T356789iu Integration Guide PDF](https://www.opentext.com/assets/documents/en-US/pdf/opentext-ig-tableau-forensic-universal-bridge-t356789iu-en.pdf)
22. [DHS NIST T356789IU Test Report PDF](https://www.dhs.gov/sites/default/files/publications/Test%20Report_NIST_HWB_Tableau%20Forensic%20Universal%20Bridge%20T356789IU_Firmware%20Version%20Apr%2026%202018%2008.49.42_October%202018.pdf)
23. [CRU UltraDock FUDv6 - CRU-inc](https://www.cru-inc.com/products/wiebetech/wiebetech_forensic_ultradock_v5/)
24. [WiebeTech FUDv6 Datasheet PDF](https://media.dustin.eu/media/d200001004274113/wiebetech-forensic-ultradock-v55-document.pdf)
25. [WiebeTech FUDv6 on Walmart $433](https://www.walmart.com/ip/WiebeTech-Forensic-UltraDock-FUDv6-3135019090000/1557211354)
26. [Digital Intelligence FRED 产品页](https://digitalintelligence.com/products/fred/)
27. [Digital Intelligence FRED-L Laptop](https://digitalintelligence.com/products/fred_l)
28. [Digital Intelligence FRED X $10,499](https://digitalintelligence.com/store/products/fred-x-forensic-workstation-f1240)
29. [Sumuri TALINO Workstations](https://sumuri.com/hardware/forensic-workstations/)
30. [Sumuri TALINO Intel Workstation $70,749](https://sumuri.com/product/talino-intel-workstation/)
31. [Sumuri Buying Your First Forensic Workstation](https://sumuri.com/buying-your-first-forensic-workstation-what-actually-matters/)
32. [Sumuri TALINO NUIX Workstation $23,249](https://sumuri.com/product/nuix-forensic-workstation/)
33. [TALINO KA-Ultra $3,299](https://talino.tech/product/talino-ka-ultra/)
34. [Forensic Computers Phantym-DX](https://www.forensiccomputers.com/phantym-dx)
35. [Exterro - Building the Perfect Forensic Workstation](https://www.exterro.com/resources/blog/building-the-perfect-forensic-workstation)
36. [Forensic Focus - Falcon-NEO Review](https://www.forensicfocus.com/reviews/falcon-neo-from-logicube/)
37. [Hawk Eye Forensic - TX1 vs Falcon-NEO comparison](https://hawkeyeforensic.com/tableau-tx1-vs-logicube-forensic-falcon-neo-in-depth-forensic-imaging-showdown/)

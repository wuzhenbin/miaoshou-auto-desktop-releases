# 妙手自动化桌面端发布制品

在本仓库运行 `npm run sync`，从同级项目的 `dist/desktop` 读取便携包，校验版本清单后生成 `dist/MiaoshouAuto-win-x64.tar.gz`。归档仅包含启动器、更新及回退命令和一个版本目录。可用 `MIAOSHOU_AUTO_SOURCE` 指定主项目路径。

正式发布使用已登录的 GitHub CLI，在本仓库执行 `npm run sync -- --publish`。仓库需已有默认分支。发布标签为 `sha256-<完整版本 SHA-256>`。新版本成为 latest 后清理本渠道更早的正式 Release 和相应标签，只保留一个正式版。发布时一次只运行一个发布任务。

客户从最新 Release 下载附件并解压完成首装。后续退出工作台后双击原目录的 `update.cmd` 即可完成更新。

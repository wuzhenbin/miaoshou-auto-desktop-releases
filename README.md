# 妙手自动化桌面端发布制品

在本仓库运行 `npm run sync`，从同级项目的 `dist/desktop` 读取便携包并生成两个附件。完整包 `dist/MiaoshouAuto-win-x64.tar.gz` 用于首装、旧更新器和组件变更。业务更新包 `dist/MiaoshouAuto-win-x64-app.tar.gz` 包含完整版本清单和业务程序，省略运行时和后端依赖。两个附件均在解压后校验。可用 `MIAOSHOU_AUTO_SOURCE` 指定主项目路径。

正式发布使用已登录的 GitHub CLI，在本仓库执行 `npm run sync -- --publish`。脚本从 GitHub 下载当前完整版本的业务附件，校验并比较启动器、桌面壳、运行时和后端依赖的摘要。完全一致时只生成并上传 `MiaoshouAuto-win-x64-app-<版本 SHA-256>.tar.gz`，作为当前 Release 的最新业务更新附件。启动器或其余组件有变化时创建新的完整 Release。首次启用该流程需要发布带新更新器和启动器摘要的完整版本，也可用 `npm run sync -- --publish --full` 指定完整发布。

完整 Release 标签为 `sha256-<完整版本 SHA-256>`。新业务附件校验通过后清理之前的业务更新附件。新完整版本成为 latest 后清理更早的完整 Release 和相应标签。发布时一次只运行一个发布任务。

客户从最新 Release 下载附件并解压完成首装。后续退出工作台后双击原目录的 `update.cmd` 即可完成更新。

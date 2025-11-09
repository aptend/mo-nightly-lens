我希望构建一个浏览器插件项目，核心目的是 github actions 的状态提取。


https://github.com/matrixorigin/mo-nightly-regression/actions/workflows/branch-nightly-regression-tke-new.yaml 这个页面是 Maxtrixone 数据库的每日回归, 我想提取这个页面中的指定 workflow 的运行状态，并展示在浏览器插件中。


以 https://github.com/matrixorigin/mo-nightly-regression/actions/runs/19072270367 这个 workflow 为例， 我们首先需要做的事情是，查看其名为 Branch Nightly Regression Test / SETUP MO TEST ENV 的 job，读取 Clean TKE ENV 这一步的输出

一般长这样，No resources found in mo-branch-commit-2d3495d51-20251104 namespace.我们拿到这个 namespace 名称，展示在https://github.com/matrixorigin/mo-nightly-regression/actions/workflows/branch-nightly-regression-tke-new.yaml页面中对应 workflow 的UI 上


我们先以这个功能为例，做好模块化的设计，后续再逐步完善其他功能。比如我们还会读取其他 job / step 的日志输出，并展示在UI 上。


现在这个任务，我们依然可以拆解。


现在我们实现第一部分。

在本地 terminal 中先完成数据获取，和展示，待功能确认稳定之后，我们再继续开发浏览器插件。


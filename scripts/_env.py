#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读取项目根 .env 里的 API key。

.env 已在 .gitignore，只存在于本机；仓库里提交的是 .env.example（只有空键名）。
需要 key 的抓取脚本共用这一个实现：fetch_stays_tourapi.py、fetch_stays_kakao.py。

已 export 的同名环境变量优先于 .env —— 临时换 key 不用改文件。
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".env")


def load_env(path: str = ENV_FILE) -> int:
    """把 .env 里的键读进 os.environ，返回读入条数。

    空值、注释行、没有 = 的行一律跳过，所以 .env.example 原样复制也不会读出空 key。
    """
    if not os.path.isfile(path):
        return 0
    n = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip("'\"")
            if not k or not v or k in os.environ:
                continue
            os.environ[k] = v
            n += 1
    return n

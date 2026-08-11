"""本地开发用无缓存静态服务器。

浏览器缓存旧 ES Module 时，页面可能表现为“代码已修改但功能没变化”。本脚本在标准
SimpleHTTPRequestHandler 上补充禁用缓存响应头，并从仓库根目录监听 8090 端口。
它只服务本地调试，不是生产服务器，也没有 TLS、认证或目录访问控制。
"""

import http.server
import os
import socketserver

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """为每个静态响应增加禁止浏览器缓存的响应头。"""

    def end_headers(self):
        # 强制浏览器每次都重新拉取，避免缓存旧 JS 导致功能“点了没反应”
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

# 无论从哪个工作目录启动，都把静态文件根固定到脚本所在的仓库目录。
os.chdir(os.path.dirname(os.path.abspath(__file__)))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", 8090), NoCacheHandler) as httpd:
    print("serving on http://0.0.0.0:8090 (no-cache)")
    httpd.serve_forever()

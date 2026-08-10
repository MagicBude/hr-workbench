import http.server, socketserver, os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 强制浏览器每次都重新拉取，避免缓存旧 JS 导致功能“点了没反应”
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", 8090), NoCacheHandler) as httpd:
    print("serving on http://0.0.0.0:8090 (no-cache)")
    httpd.serve_forever()

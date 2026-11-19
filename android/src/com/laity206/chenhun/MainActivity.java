package com.laity206.chenhun;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 晨昏日程 · 安卓壳
 * 用 file:// 之外的方式加载本地页面：拦截 https://appassets.local/ 请求，
 * 直接返回 assets 里的字节。这样页面有一个正常的 https 源，localStorage 稳定可用。
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.local";
    private static final String BASE = "https://" + HOST + "/";

    private WebView web;
    private LanServer lan;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        if (Build.VERSION.SDK_INT >= 21) w.setStatusBarColor(Color.parseColor("#F6F4EF"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F6F4EF"));
        root.setFitsSystemWindows(true);

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        /* 允许通过 adb + chrome://inspect 调试页面，排障用；不影响正常使用 */
        if (Build.VERSION.SDK_INT >= 19) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(Color.parseColor("#F6F4EF"));
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "__CHX_NATIVE__");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                String url = req.getUrl() == null ? "" : req.getUrl().toString();
                if (!url.startsWith(BASE)) return null;
                String name = url.substring(BASE.length());
                int q = name.indexOf('?');
                if (q >= 0) name = name.substring(0, q);
                if (name.isEmpty()) name = "index.html";
                try {
                    InputStream in = getAssets().open(name);
                    String mime = name.endsWith(".html") ? "text/html"
                            : name.endsWith(".js") ? "application/javascript"
                            : name.endsWith(".css") ? "text/css"
                            : name.endsWith(".png") ? "image/png"
                            : name.endsWith(".svg") ? "image/svg+xml"
                            : "application/octet-stream";
                    return new WebResourceResponse(mime, "utf-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8",
                            new java.io.ByteArrayInputStream("not found".getBytes()));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return !url.startsWith(BASE);
            }
        });

        setContentView(root);
        web.loadUrl(BASE + "index.html");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (lan != null) lan.stop();
        if (web != null) {
            web.removeJavascriptInterface("__CHX_NATIVE__");
            web.destroy();
        }
        pool.shutdownNow();
        super.onDestroy();
    }

    /* ============================================================
     *  JS 桥：所有方法最后多一个 cbId，完成后回调 __chxResolve
     * ============================================================ */
    private class Bridge {

        @JavascriptInterface
        public void http(final String method, final String url, final String body,
                         final String headersJson, final int timeout, final String cbId) {
            pool.execute(new Runnable() {
                public void run() {
                    String payload;
                    try {
                        payload = doHttp(method, url, body, headersJson, timeout);
                    } catch (Exception e) {
                        payload = "{\"status\":0,\"body\":\"\",\"error\":" + jstr(msg(e)) + "}";
                    }
                    resolve(cbId, true, payload);
                }
            });
        }

        @JavascriptInterface
        public void startHost(final int port, final String cbId) {
            pool.execute(new Runnable() {
                public void run() {
                    try {
                        if (lan == null) lan = new LanServer();
                        if (!lan.isRunning()) lan.start(port);
                        List<String> ips = localIps();
                        String first = ips.isEmpty() ? "" : ips.get(0);
                        resolve(cbId, true, "{\"ok\":true,\"port\":" + lan.getPort()
                                + ",\"code\":\"" + lan.getCode() + "\",\"ips\":[\"" + esc(first) + "\"]}");
                    } catch (Exception e) {
                        resolve(cbId, true, "{\"ok\":false,\"error\":" + jstr(msg(e)) + "}");
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopHost(final String cbId) {
            pool.execute(new Runnable() {
                public void run() {
                    if (lan != null) lan.stop();
                    resolve(cbId, true, "{\"ok\":true}");
                }
            });
        }

        @JavascriptInterface
        public void hostInfo(final String cbId) {
            pool.execute(new Runnable() {
                public void run() {
                    if (lan == null || !lan.isRunning()) {
                        resolve(cbId, true, "{\"ok\":false,\"ver\":0,\"state\":null}");
                        return;
                    }
                    String st = lan.getState();
                    resolve(cbId, true, "{\"ok\":true,\"ver\":" + lan.getVer()
                            + ",\"from\":\"" + esc(lan.getFrom()) + "\",\"state\":" + (st == null ? "null" : st) + "}");
                }
            });
        }

        @JavascriptInterface
        public void setHostState(final String json, final String cbId) {
            if (lan != null) lan.setState(json);
            resolve(cbId, true, "{\"ok\":true}");
        }

        @JavascriptInterface
        public void getIps(final String cbId) {
            List<String> ips = localIps();
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < ips.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append('"').append(esc(ips.get(i))).append('"');
            }
            sb.append(']');
            resolve(cbId, true, sb.toString());
        }
    }

    /* ---------------- HTTP 客户端（绕开 WebView 的 CORS） ---------------- */
    private String doHttp(String method, String url, String body, String headersJson, int timeout) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method.toUpperCase(Locale.ROOT));
        c.setConnectTimeout(Math.max(timeout, 3000));
        c.setReadTimeout(Math.max(timeout, 3000));
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Chenhun/1.0");

        List<String[]> hs = parseHeaders(headersJson);
        for (String[] h : hs) c.setRequestProperty(h[0], h[1]);

        if (body != null && body.length() > 0) {
            c.setDoOutput(true);
            byte[] bytes = body.getBytes("UTF-8");
            if (c.getRequestProperty("Content-Type") == null) {
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            }
            c.setFixedLengthStreamingMode(bytes.length);
            OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.flush();
            os.close();
        }

        int code = c.getResponseCode();
        InputStream in = null;
        try { in = c.getInputStream(); } catch (IOException e) { in = c.getErrorStream(); }

        String text = "";
        if (in != null) {
            BufferedInputStream bis = new BufferedInputStream(in);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = bis.read(buf)) > 0) bos.write(buf, 0, n);
            bis.close();
            text = new String(bos.toByteArray(), "UTF-8");
        }
        c.disconnect();
        return "{\"status\":" + code + ",\"body\":" + jstr(text) + "}";
    }

    private List<String[]> parseHeaders(String json) {
        List<String[]> out = new ArrayList<String[]>();
        if (json == null || json.length() < 4) return out;
        // 只有一个 Authorization 时是最常见情况，做一次快速解析；其余走通用扫描
        String s = json.trim();
        if (s.startsWith("{") && s.endsWith("}")) s = s.substring(1, s.length() - 1);
        int i = 0;
        while (i < s.length()) {
            int k1 = s.indexOf('"', i);
            if (k1 < 0) break;
            int k2 = s.indexOf('"', k1 + 1);
            if (k2 < 0) break;
            String key = s.substring(k1 + 1, k2);
            int colon = s.indexOf(':', k2);
            if (colon < 0) break;
            int v1 = s.indexOf('"', colon);
            if (v1 < 0) break;
            int v2 = s.indexOf('"', v1 + 1);
            if (v2 < 0) break;
            String val = s.substring(v1 + 1, v2);
            out.add(new String[]{key, val});
            i = v2 + 1;
        }
        return out;
    }

    private List<String> localIps() {
        List<String> all = new ArrayList<String>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        all.add(a.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) { }
        return all;
    }

    /* ---------------- 回调 JS ---------------- */
    private void resolve(final String cbId, final boolean ok, final String payload) {
        final String js = "__chxResolve(" + jstr(cbId) + "," + (ok ? "true" : "false") + "," + jstr(payload) + ");";
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    /** Java 字符串 -> JSON 字面量（含引号） */
    private static String jstr(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** 用于把字符串嵌进小 JSON 对象 */
    private static String esc(String s) {
        String j = jstr(s);
        return j.substring(1, j.length() - 1);
    }

    private static String msg(Exception e) {
        return e == null ? "unknown" : (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
    }

    /* ============================================================
     *  局域网中转服务：一个只有三个路由的极简 HTTP 服务
     * ============================================================ */
    private static class LanServer {
        private ServerSocket ss;
        private Thread thread;
        private volatile boolean running = false;
        private volatile String state = null;
        private volatile String from = "";
        private volatile int ver = 0;
        private String code = "0000";

        boolean isRunning() { return running; }
        String getState() { return state; }
        String getFrom() { return from; }
        int getVer() { return ver; }
        String getCode() { return code; }
        void setState(String json) {
            try {
                String st = extractField(json, "state");
                if (st != null) {
                    state = st;
                } else {
                    state = json;
                }
            } catch (Exception e) { state = null; }
        }

        int getPort() { return ss == null ? 0 : ss.getLocalPort(); }

        void start(int port) throws IOException {
            ss = new ServerSocket(port);
            code = String.valueOf(1000 + (int) (Math.random() * 9000));
            running = true;
            thread = new Thread(new Runnable() {
                public void run() {
                    while (running) {
                        Socket s = null;
                        try {
                            s = ss.accept();
                            handle(s);
                        } catch (Exception e) {
                            if (running && !(e instanceof java.net.SocketException)) { /* ignore */ }
                        } finally {
                            try { if (s != null) s.close(); } catch (Exception ignored) { }
                        }
                    }
                }
            });
            thread.setDaemon(true);
            thread.start();
        }

        void stop() {
            running = false;
            try { if (ss != null) ss.close(); } catch (Exception ignored) { }
            ss = null;
            if (thread != null) thread.interrupt();
            thread = null;
        }

        private void handle(Socket s) throws IOException {
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();

            StringBuilder head = new StringBuilder();
            int b, w0 = -1, w1 = -1, w2 = -1, w3 = -1;
            while ((b = in.read()) >= 0) {
                head.append((char) b);
                w0 = w1; w1 = w2; w2 = w3; w3 = b;
                if (w0 == '\r' && w1 == '\n' && w2 == '\r' && w3 == '\n') break;
                if (head.length() > 16384) break;
            }

            String[] lines = head.toString().split("\r?\n");
            if (lines.length == 0) return;
            String[] first = lines[0].split(" ");
            if (first.length < 2) return;
            String method = first[0].toUpperCase(Locale.ROOT);
            String path = first[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);

            int len = 0;
            for (int i = 1; i < lines.length; i++) {
                String l = lines[i];
                int c = l.indexOf(':');
                if (c > 0 && l.substring(0, c).trim().equalsIgnoreCase("Content-Length")) {
                    try { len = Integer.parseInt(l.substring(c + 1).trim()); } catch (Exception ignored) { }
                }
            }

            byte[] bodyBytes = new byte[0];
            if (len > 0 && len < 16 * 1024 * 1024) {
                bodyBytes = new byte[len];
                int got = 0;
                while (got < len) {
                    int n = in.read(bodyBytes, got, len - got);
                    if (n < 0) break;
                    got += n;
                }
            }
            String reqBody = new String(bodyBytes, "UTF-8");

            if (path.equals("/chx/ping")) {
                send(out, 200, "{\"app\":\"chenhun\",\"v\":\"1.0\",\"ver\":" + ver + "}");
            } else if (path.equals("/chx/state") && method.equals("GET")) {
                send(out, 200, "{\"state\":" + (state == null ? "null" : state) + ",\"ver\":" + ver + "}");
            } else if (path.equals("/chx/state") && method.equals("POST")) {
                try {
                    String st = extractField(reqBody, "state");
                    String fr = extractField(reqBody, "from");
                    if (st != null) state = st;
                    if (fr != null) from = unquote(fr);
                    ver += 1;
                    send(out, 200, "{\"ok\":true,\"ver\":" + ver + "}");
                } catch (Exception e) {
                    send(out, 400, "{\"ok\":false,\"error\":\"bad json\"}");
                }
            } else {
                send(out, 404, "{\"ok\":false}");
            }
        }

        /** 从 {"state":{...},"from":"xx"} 里取出某个字段的原始片段 */
        private static String extractField(String json, String key) {
            String marker = "\"" + key + "\":";
            int i = json.indexOf(marker);
            if (i < 0) return null;
            int start = i + marker.length();
            int depth = 0;
            boolean inStr = false, esc = false;
            for (int p = start; p < json.length(); p++) {
                char c = json.charAt(p);
                if (inStr) {
                    if (esc) esc = false;
                    else if (c == '\\') esc = true;
                    else if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '{' || c == '[') depth++;
                else if (c == '}' || c == ']') {
                    if (depth == 0) return json.substring(start, p).trim();
                    depth--;
                } else if (c == ',' && depth == 0) {
                    return json.substring(start, p).trim();
                }
            }
            return json.substring(start).replaceAll("}$", "").trim();
        }

        private static String unquote(String s) {
            if (s == null) return "";
            s = s.trim();
            if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
                return s.substring(1, s.length() - 1);
            }
            return s;
        }

        private static void send(OutputStream out, int code, String body) throws IOException {
            byte[] b = body.getBytes("UTF-8");
            String head = "HTTP/1.1 " + code + " " + (code == 200 ? "OK" : code == 404 ? "Not Found" : "Bad Request") + "\r\n"
                    + "Content-Type: application/json; charset=utf-8\r\n"
                    + "Content-Length: " + b.length + "\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(head.getBytes("UTF-8"));
            out.write(b);
            out.flush();
        }
    }
}

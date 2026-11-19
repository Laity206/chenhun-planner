#!/bin/bash
# 晨昏日程 · 安卓打包（不依赖 Gradle）
# 注意：aapt2 / javac / d8 / apksigner 都是 Windows 程序，不认 MSYS 的 /d/... 路径。
# 所以全程 cd 到工程根目录，只用相对路径；只有 JAVA_HOME 用 cygpath 转成 Windows 形式。
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)

BUILD=android/build
JDK=tools/jdk
BT=tools/android-sdk/build-tools/34.0.0
ANDROID_JAR=tools/android-sdk/platforms/android-34/android.jar
OUT=dist/android
KS=android/chx.keystore
KS_PASS=chenhun2026
ALIAS=chenhun

export JAVA_HOME="$(cygpath -w "$ROOT/$JDK")"
export PATH="$ROOT/$JDK/bin:$PATH"

echo "== 0. 同步静态资源 =="
cp common/index.html common/sync-core.js android/assets/
ls -1 android/assets/

echo "== 1. 清理 =="
rm -rf "$BUILD"
mkdir -p "$BUILD/obj" "$BUILD/dex" "$OUT"

echo "== 2. 编译资源 =="
"$BT/aapt2.exe" compile --dir android/res -o "$BUILD/res.zip"
ls -lh "$BUILD/res.zip"

echo "== 3. 链接生成基础 APK =="
"$BT/aapt2.exe" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest android/AndroidManifest.xml \
  -R "$BUILD/res.zip" \
  -A android/assets \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  --auto-add-overlay
ls -lh "$BUILD/base.apk"

echo "== 4. 编译 Java =="
find android/src -name "*.java" > "$BUILD/sources.txt"
cat "$BUILD/sources.txt"
"$JDK/bin/javac.exe" -encoding UTF-8 -nowarn -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" \
  -d "$BUILD/obj" \
  "@$BUILD/sources.txt" 2>&1 | sed 's/^/   /' || true

test -f "$BUILD/obj/com/laity206/chenhun/MainActivity.class" || { echo "!! 编译失败：没生成 MainActivity.class"; exit 1; }
echo "   class 文件数: $(find "$BUILD/obj" -name '*.class' | wc -l)"

echo "== 5. 转 dex =="
CLASSES=$(find "$BUILD/obj" -name "*.class" | tr '\n' ' ')
"$BT/d8.bat" --release --min-api 23 --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" $CLASSES
ls -lh "$BUILD/dex"

echo "== 6. 合并 dex 进 APK =="
python tools/addzip.py "$BUILD/base.apk" "$BUILD/merged.apk" "$BUILD/dex/classes.dex"

echo "== 7. 对齐 =="
"$BT/zipalign.exe" -f -p 4 "$BUILD/merged.apk" "$BUILD/aligned.apk"
ls -lh "$BUILD/aligned.apk"

echo "== 8. 签名 =="
if [ ! -f "$KS" ]; then
  echo "  生成签名证书（首次）"
  "$JDK/bin/keytool.exe" -genkeypair \
    -keystore "$KS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Laity206, OU=Chenhun, O=Chenhun, L=Beijing, ST=Beijing, C=CN" 2>&1 | tail -2
fi

"$BT/apksigner.bat" sign \
  --ks "$KS" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KS_PASS" \
  --min-sdk-version 23 \
  --out "$OUT/ChenhunPlanner-1.0.apk" \
  "$BUILD/aligned.apk"

echo "== 9. 校验 =="
"$BT/apksigner.bat" verify --verbose "$OUT/ChenhunPlanner-1.0.apk" | head -8

echo ""
ls -lh "$OUT/ChenhunPlanner-1.0.apk"
echo "APK 完成"

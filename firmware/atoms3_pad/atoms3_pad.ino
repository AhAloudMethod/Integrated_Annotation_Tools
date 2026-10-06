// AtomS3 Lite を、アノテータが読むゲームパッド（USB HID）にするスケッチ
// 機器との約束（core/gamepad.js・README の「コントローラー（ゲームパッド）」）：
//   軸0＝ジョイスティック横（右＝＋）、軸1＝ジョイスティック縦（下＝＋。アノテータの中で反転する）
//   軸2＝スライダー1、軸3＝スライダー2（+1＝上＝値が高い）、ボタン0＝記録のオン／オフ
// つなぎ方（README の「M5Stack の機器」）：
//   本体の Grove → Grove Hub（U006）→ Unit Joystick2（U024-C、I2C 0x63）と PbHub v1.1（U041、I2C 0x61）
//   Unit Fader（U123）×2 → PbHub の CH0・CH1（フェーダーの白＝位置の電圧を、PbHub がそのチャネルの IO0 で読む）
// ボード設定（Arduino IDE）：ボード「M5Stack-ATOMS3」、USB Mode「USB-OTG (TinyUSB)」、USB CDC On Boot「Enabled」
#include <Arduino.h>
#include <Wire.h>
#include "USB.h"
#include "USBHIDGamepad.h"

// ---------- 機器ごとに合わせる設定 ----------
// 向きが逆なら true にする（アノテータの「設定」→「コントローラー」で軸のバーを見て確かめる）
const bool INVERT_STICK_X = false;  // スティックを右に倒して軸0が＋になればそのまま
const bool INVERT_STICK_Y = false;  // スティックを手前（下）に倒して軸1が＋になればそのまま
const bool INVERT_FADER[2] = { false, false };  // つまみを上（奥）に動かして軸2・3が＋になればそのまま

// フェーダーを挿した PbHub のチャネル（0〜5）。1本だけなら 2本目を -1 にする（軸3は中央 0 のまま）
const int FADER_CH[2] = { 0, 1 };
// フェーダーの両端の読み値（12 bit）。端まで動かしても ±1 に届かないときは狭める（シリアルモニタに読み値が出る）
const int FADER_MIN = 80;
const int FADER_MAX = 4000;

// スティックの押し込みもボタン0（記録）にするか。強く倒すと押し込みが入りやすく、押し込むと値も揺れるので既定は本体の画面ボタンだけ
const bool STICK_PRESS_RECORDS = false;

// ---------- ピンと定数 ----------
const int PIN_SDA = 2, PIN_SCL = 1;     // 本体の Grove
const int PIN_BUTTON = 41;              // 本体の画面ボタン（押すと LOW）
const int PIN_LED = 35;                 // 本体の RGB LED
const uint8_t JOY_ADDR = 0x63;
const uint8_t JOY_REG_OFFSET_XY = 0x50; // 中心を 0 にした値（x・y の int16、−4095〜4095）
const uint8_t JOY_REG_BUTTON = 0x20;    // 押すと 0
const uint8_t JOY_REG_RGB = 0x30;
const uint8_t HUB_ADDR = 0x61;
const uint8_t HUB_REG_ANALOG = 0x06;    // チャネルの番地（(ch + 4) << 4）に足す。IO0 の 12 bit
const uint32_t LOOP_MS = 5;             // 200 Hz で読む
const uint32_t RETRY_MS = 1000;         // 見つからない機器を探し直す間隔（抜き差ししても戻る）
const uint32_t LOG_MS = 200;            // シリアルモニタへの表示の間隔
const uint32_t DEBOUNCE_MS = 20;        // ボタンの状態がこの間続いたら切り替える（チャタリングで記録がオン・オフを繰り返さないように）

USBHIDGamepad gamepad;
bool joyFound = false, hubFound = false;
uint32_t retryAt = 0, logAt = 0;
float faderAvg[2] = { -1, -1 };  // 読み値の移動平均（-1 は未初期化）
int8_t faderOut[2] = { 0, 0 };
int8_t lastX = 0, lastY = 0, lastZ = 0, lastRx = 0;
uint32_t lastButtons = 0;
bool sentOnce = false;

// チャタリング除け：生の状態が DEBOUNCE_MS 続いたときだけ state を変える
struct Debounce {
  bool state = false, raw = false;
  uint32_t since = 0;
  bool update(bool now, uint32_t t) {
    if (now != raw) { raw = now; since = t; }
    else if (raw != state && t - since >= DEBOUNCE_MS) state = raw;
    return state;
  }
};
Debounce bodyBtn, stickBtn;

int8_t toAxis(long v, long lo, long hi) {
  v = constrain(v, lo, hi);
  return (int8_t)map(v, lo, hi, -127, 127);
}

bool i2cExists(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool i2cWrite(uint8_t addr, uint8_t reg, const uint8_t *buf, size_t len) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(buf, len);
  return Wire.endTransmission() == 0;
}

bool i2cRead(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)len) != len) return false;
  for (size_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

void setStatusLed() {
  // 緑＝両方あり、黄＝片方だけ、赤＝どちらも見つからない
  if (joyFound && hubFound) neopixelWrite(PIN_LED, 0, 24, 0);
  else if (joyFound || hubFound) neopixelWrite(PIN_LED, 24, 16, 0);
  else neopixelWrite(PIN_LED, 24, 0, 0);
}

void findDevices() {
  if (!joyFound && (joyFound = i2cExists(JOY_ADDR))) {
    uint8_t green[4] = { 0x00, 0x20, 0x00, 0 };  // 0x00RRGGBB の little endian
    i2cWrite(JOY_ADDR, JOY_REG_RGB, green, 4);
  }
  if (!hubFound) hubFound = i2cExists(HUB_ADDR);
  setStatusLed();
}

// スティック：遊びの内側は機器側（Joystick2 の中の校正）で 0 になる
bool readStick(int8_t &x, int8_t &y, bool &pressed) {
  uint8_t b[4], btn;
  if (!i2cRead(JOY_ADDR, JOY_REG_OFFSET_XY, b, 4) || !i2cRead(JOY_ADDR, JOY_REG_BUTTON, &btn, 1)) return false;
  int16_t rx = (int16_t)(b[0] | (b[1] << 8)), ry = (int16_t)(b[2] | (b[3] << 8));
  x = toAxis(INVERT_STICK_X ? -rx : rx, -4095, 4095);
  y = toAxis(INVERT_STICK_Y ? -ry : ry, -4095, 4095);
  pressed = btn == 0;
  return true;
}

// PbHub のチャネルの IO0 のアナログ値（0〜4095）。CH5 は番地が1つ飛ぶ（M5UnitPbHub と同じ）
bool hubAnalog(int ch, int &raw) {
  uint8_t c = ch == 5 ? 6 : ch, b[2];
  if (!i2cRead(HUB_ADDR, ((c + 4) << 4) | HUB_REG_ANALOG, b, 2)) return false;
  raw = b[0] | (b[1] << 8);
  return true;
}

// フェーダー：4回平均＋移動平均でならし、1目盛りの揺れは出さない（アノテータは 0.02＝約3目盛りを超えると「動かした」とみなす）
int8_t readFader(int i, int &raw) {
  raw = -1;
  if (FADER_CH[i] < 0 || !hubFound) return 0;
  long sum = 0;
  for (int k = 0; k < 4; k++) {
    int r;
    if (!hubAnalog(FADER_CH[i], r)) { hubFound = false; setStatusLed(); return faderOut[i]; }
    sum += r;
  }
  raw = sum / 4;
  faderAvg[i] = faderAvg[i] < 0 ? raw : faderAvg[i] * 0.7f + raw * 0.3f;
  int8_t v = toAxis(lround(faderAvg[i]), FADER_MIN, FADER_MAX);
  if (INVERT_FADER[i]) v = -v;
  if (abs(v - faderOut[i]) >= 2 || v == 127 || v == -127) faderOut[i] = v;
  return faderOut[i];
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  // ブラウザの gamepad.id に出る名前
  USB.manufacturerName("M5Stack");
  USB.productName("AH Annotator Pad (AtomS3)");
  gamepad.begin();
  USB.begin();

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  findDevices();
}

void loop() {
  uint32_t now = millis();

  int8_t x = 0, y = 0;
  bool stickPressed = false;
  if (joyFound && !readStick(x, y, stickPressed)) { joyFound = false; setStatusLed(); x = y = 0; }
  if ((!joyFound || !hubFound) && now >= retryAt) { findDevices(); retryAt = now + RETRY_MS; }

  int raw[2];
  int8_t z = readFader(0, raw[0]), rx = readFader(1, raw[1]);

  bool bodyPressed = bodyBtn.update(digitalRead(PIN_BUTTON) == LOW, now);
  stickPressed = stickBtn.update(stickPressed, now);
  // ボタン0＝記録（本体の画面ボタン、設定によりスティックの押し込みも）。ボタン1＝本体、ボタン2＝スティック（表示用）
  uint32_t buttons = 0;
  if (bodyPressed || (STICK_PRESS_RECORDS && stickPressed)) buttons |= 1u << 0;
  if (bodyPressed) buttons |= 1u << 1;
  if (stickPressed) buttons |= 1u << 2;

  // スライダー2は Rz と Rx の両方に送る（ブラウザが軸を用途順〔X,Y,Z,Rx〕に並べても報告順〔X,Y,Z,Rz〕に並べても軸3になる）
  if (!sentOnce || x != lastX || y != lastY || z != lastZ || rx != lastRx || buttons != lastButtons) {
    if (gamepad.send(x, y, z, rx, rx, 0, HAT_CENTER, buttons)) {
      lastX = x; lastY = y; lastZ = z; lastRx = rx; lastButtons = buttons; sentOnce = true;
    }
  }

  if (now >= logAt) {
    logAt = now + LOG_MS;
    Serial.printf("joy=%s x=%4d y=%4d press=%d | pbhub=%s fader1 raw=%4d axis=%4d | fader2 raw=%4d axis=%4d | button=%d\n",
                  joyFound ? "ok" : "--", x, y, stickPressed, hubFound ? "ok" : "--", raw[0], z, raw[1], rx, bodyPressed);
  }
  delay(LOOP_MS);
}

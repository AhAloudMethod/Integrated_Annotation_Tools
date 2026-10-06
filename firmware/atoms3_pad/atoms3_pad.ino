// AtomS3 Lite を、アノテータが読むゲームパッド（USB HID）にするスケッチ
// 機器との約束（core/gamepad.js・README の「コントローラー（ゲームパッド）」）：
//   軸0＝ジョイスティック横（右＝＋）、軸1＝ジョイスティック縦（下＝＋。アノテータの中で反転する）
//   軸2＝スライダー1、軸3＝スライダー2（+1＝上＝値が高い）、ボタン0＝記録のオン／オフ
// つなぎ方（README の「M5Stack の機器」）：
//   Unit Joystick2（U024-C、I2C 0x63）→ 本体の Grove（黄＝G2＝SDA、白＝G1＝SCL）
//   Unit Fader（U123）×2 → 黄（位置の電圧）を G7・G8 へ、赤を 5V、黒を GND（白の LED は使わない）
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

// フェーダーをつないだピン。1本だけなら 2本目を -1 にする（軸3は中央 0 のまま）
const int FADER_PINS[2] = { 7, 8 };
// フェーダーの両端の読み値（12 bit）。端まで動かしても ±1 に届かないときは狭める（シリアルモニタに読み値が出る）
const int FADER_MIN = 80;
const int FADER_MAX = 4000;

// スティックの押し込みもボタン0（記録）にするか。押し込むと値が揺れるので、本体の画面ボタンだけにするなら false
const bool STICK_PRESS_RECORDS = true;

// ---------- ピンと定数 ----------
const int PIN_SDA = 2, PIN_SCL = 1;     // 本体の Grove
const int PIN_BUTTON = 41;              // 本体の画面ボタン（押すと LOW）
const int PIN_LED = 35;                 // 本体の RGB LED
const uint8_t JOY_ADDR = 0x63;
const uint8_t JOY_REG_OFFSET_XY = 0x50; // 中心を 0 にした値（x・y の int16、−4095〜4095）
const uint8_t JOY_REG_BUTTON = 0x20;    // 押すと 0
const uint8_t JOY_REG_RGB = 0x30;
const uint32_t LOOP_MS = 5;             // 200 Hz で読む
const uint32_t LOG_MS = 200;            // シリアルモニタへの表示の間隔

USBHIDGamepad gamepad;
bool joyFound = false;
uint32_t joyRetryAt = 0, logAt = 0;
float faderAvg[2] = { -1, -1 };  // 読み値の移動平均（-1 は未初期化）
int8_t faderOut[2] = { 0, 0 };
int8_t lastX = 0, lastY = 0, lastZ = 0, lastRx = 0;
uint32_t lastButtons = 0;
bool sentOnce = false;

int8_t toAxis(long v, long lo, long hi) {
  v = constrain(v, lo, hi);
  return (int8_t)map(v, lo, hi, -127, 127);
}

bool joyWrite(uint8_t reg, const uint8_t *buf, size_t len) {
  Wire.beginTransmission(JOY_ADDR);
  Wire.write(reg);
  Wire.write(buf, len);
  return Wire.endTransmission() == 0;
}

bool joyRead(uint8_t reg, uint8_t *buf, size_t len) {
  Wire.beginTransmission(JOY_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(JOY_ADDR, (uint8_t)len) != len) return false;
  for (size_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

void joySetColor(uint32_t rgb) {
  uint8_t b[4] = { (uint8_t)rgb, (uint8_t)(rgb >> 8), (uint8_t)(rgb >> 16), 0 };
  joyWrite(JOY_REG_RGB, b, 4);
}

void setStatusLed() {
  // 緑＝ジョイスティックあり、赤＝見つからない
  if (joyFound) neopixelWrite(PIN_LED, 0, 24, 0);
  else neopixelWrite(PIN_LED, 24, 0, 0);
}

void findJoystick() {
  Wire.beginTransmission(JOY_ADDR);
  joyFound = Wire.endTransmission() == 0;
  if (joyFound) joySetColor(0x002000);
  setStatusLed();
}

// スティック：遊びの内側は機器側（Joystick2 の中の校正）で 0 になる
bool readStick(int8_t &x, int8_t &y, bool &pressed) {
  uint8_t b[4], btn;
  if (!joyRead(JOY_REG_OFFSET_XY, b, 4) || !joyRead(JOY_REG_BUTTON, &btn, 1)) return false;
  int16_t rx = (int16_t)(b[0] | (b[1] << 8)), ry = (int16_t)(b[2] | (b[3] << 8));
  x = toAxis(INVERT_STICK_X ? -rx : rx, -4095, 4095);
  y = toAxis(INVERT_STICK_Y ? -ry : ry, -4095, 4095);
  pressed = btn == 0;
  return true;
}

// フェーダー：8回平均＋移動平均でならし、1目盛りの揺れは出さない（アノテータは 0.02＝約3目盛りを超えると「動かした」とみなす）
int8_t readFader(int i, int &raw) {
  if (FADER_PINS[i] < 0) { raw = -1; return 0; }
  long sum = 0;
  for (int k = 0; k < 8; k++) sum += analogRead(FADER_PINS[i]);
  raw = sum / 8;
  faderAvg[i] = faderAvg[i] < 0 ? raw : faderAvg[i] * 0.7f + raw * 0.3f;
  int8_t v = toAxis(lround(faderAvg[i]), FADER_MIN, FADER_MAX);
  if (INVERT_FADER[i]) v = -v;
  if (abs(v - faderOut[i]) >= 2 || v == 127 || v == -127) faderOut[i] = v;
  return faderOut[i];
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  analogReadResolution(12);
  for (int i = 0; i < 2; i++) if (FADER_PINS[i] >= 0) analogSetPinAttenuation(FADER_PINS[i], ADC_11db);

  // ブラウザの gamepad.id に出る名前
  USB.manufacturerName("M5Stack");
  USB.productName("AH Annotator Pad (AtomS3)");
  gamepad.begin();
  USB.begin();

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  findJoystick();
}

void loop() {
  uint32_t now = millis();

  int8_t x = 0, y = 0;
  bool stickPressed = false;
  if (joyFound && !readStick(x, y, stickPressed)) { joyFound = false; setStatusLed(); x = y = 0; }
  if (!joyFound && now >= joyRetryAt) { findJoystick(); joyRetryAt = now + 1000; }  // 抜き差ししても1秒以内に戻る

  int raw[2];
  int8_t z = readFader(0, raw[0]), rx = readFader(1, raw[1]);

  bool bodyPressed = digitalRead(PIN_BUTTON) == LOW;
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
    Serial.printf("joy=%s x=%4d y=%4d press=%d | fader1 raw=%4d axis=%4d | fader2 raw=%4d axis=%4d | button=%d\n",
                  joyFound ? "ok" : "--", x, y, stickPressed, raw[0], z, raw[1], rx, bodyPressed);
  }
  delay(LOOP_MS);
}

# trackPrint

Four heart-rate sensors → four-voice electronic band in the browser.
ch0 drums · ch1 bass · ch2 lead · ch3 pad.

## Parts
- Arduino Uno (or Leonardo)
- TCA9548A I2C multiplexer (required: every MAX30102 has the same address, 0x57)
- 4x MAX30102 breakout

## Wiring
| From | To |
|---|---|
| Arduino 3.3V | TCA9548A VIN, each MAX30102 VIN |
| Arduino GND | TCA9548A GND, each MAX30102 GND, TCA A0/A1/A2 |
| Uno A4 (SDA) / Leonardo D2 | TCA9548A SDA |
| Uno A5 (SCL) / Leonardo D3 | TCA9548A SCL |
| TCA SD0/SC0 … SD3/SC3 | Sensor 0 … 3 SDA/SCL |

Keep all I2C pull-ups at 3.3V. If a sensor reads `0`, check its address, its wiring, and its pull-up voltage. Some cheap purple MAX30102 boards pull SDA/SCL up to 1.8V, and those need the pull-up jumper or trace moved to 3.3V.

## Firmware
```bash
arduino-cli lib install "SparkFun MAX3010x Pulse and Proximity Sensor Library"
arduino-cli board list                      # find the port
arduino-cli upload -b arduino:avr:uno -p <port> firmware/trackprint
```
Check: `arduino-cli monitor -p <port> -c baudrate=115200` shows `ir0,ir1,ir2,ir3` lines; a value jumps above ~50000 with a finger on.

## Run
```bash
cd web && python3 -m http.server 8000
```
Open http://localhost:8000 in Chrome or Edge. Use **Simulate** (no hardware) or **Connect sensors**.

## Test
```bash
node web/test.mjs
```

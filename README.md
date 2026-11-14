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

Not all four sensors wired yet? Open http://localhost:8000/?fill=sim and use **Connect sensors**: channels whose sensor reads `0` (not plugged in) get simulated pulses, the real ones play from your fingers.

## Testing with one sensor
`firmware/trackprint_single` is for testing with a single MAX30102 wired straight to the Uno, without the mux: SDA → A4, SCL → A5, VIN → 3.3V, GND → GND. It sends the same `ir0,ir1,ir2,ir3` lines as the full firmware. The real reading goes on `CHANNEL` (default 0, drums, so your finger sets the tempo) and the other channels send `0`.

```bash
arduino-cli core install arduino:avr
arduino-cli lib install "SparkFun MAX3010x Pulse and Proximity Sensor Library"
arduino-cli compile -b arduino:avr:uno firmware/trackprint_single
arduino-cli upload  -b arduino:avr:uno -p /dev/ttyACM0 firmware/trackprint_single
```

At boot it prints one `# MAX30102 found on A4/A5` (or `not found`) line, which the web app ignores. Then come 50 lines per second. With no finger the reading is around 1,000; with a finger it's above 50,000.

To play: open http://localhost:8000/?fill=sim, click **Connect sensors**, pick the Arduino. Your finger plays drums and the other three voices are simulated.

## Troubleshooting (Linux)
These came up on an Arch Linux laptop with an Uno R3.

**No `arduino-cli`, and no sudo needed to install it.** Download the release binary into your home folder:
```bash
mkdir -p ~/.local/bin
curl -fsSL https://github.com/arduino/arduino-cli/releases/download/v1.1.1/arduino-cli_1.1.1_Linux_64bit.tar.gz | tar xz -C ~/.local/bin arduino-cli
```

**`Permission denied` on `/dev/ttyACM0` (upload), or `Failed to open serial port` in the browser.** The port belongs to the `uucp` group (`dialout` on Debian/Ubuntu), and your user has to be in it:
```bash
sudo usermod -aG uucp <your-username>      # then log out and back in (a reboot also works)
```
Group changes only apply to programs started after a fresh login. Restarting the browser isn't enough. To use the port right away, before logging out:
```bash
sudo setfacl -m u:<your-username>:rw /dev/ttyACM0   # lasts until the Arduino is unplugged
newgrp uucp                                         # a shell with the new group, for arduino-cli
```
Type your username out instead of using `$USER`. On our machine `$USER` was empty, so `setfacl` failed with `Invalid argument near character 3`.

**The browser's port picker says "No serial ports available".** This is usually the permission problem above. Also use Chrome, Chromium or Edge: Web Serial is what this project is built and tested on there. On Arch: `sudo pacman -S chromium` (official repos) or `yay -S google-chrome` (AUR).

**The picker lists lots of `ttyS0`, `ttyS1`, ... ports.** Those are built-in legacy serial ports with nothing attached. Pick **ttyACM0** (it may be labelled "Arduino Uno"). `ls -l /dev/serial/by-id/` shows which device is the Arduino.

**`Failed to open serial port` even with permissions.** Only one program can hold the port. Close `arduino-cli monitor`, the Arduino IDE serial monitor, or any other tab connected to it.

## Test
```bash
node web/test.mjs
```

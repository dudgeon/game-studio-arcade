# Virtual cabinet on the Mac mini

**Status:** design only, nothing built (2026-11-08). Decisions D120–D129 in [decisions.md](decisions.md#2026-11-08--virtual-cabinet). Open questions for Geoff are at the end.

Geoff (2026-11-08): "It will be a while before the Picade arrives, so we will need a full emulator stack running as close to accurate a version of a logically isolated (I think this is the term?) version of the cabinet on the mini."

**On the term:** "logically isolated" is right. The usual name for this is an **isolated virtual machine**. Strictly it's *virtualization*, not emulation: the mini's Arm CPU runs the cabinet's arm64 code directly, and no Pi hardware is imitated. We call it the **virtual cabinet**.

## What it is

The virtual cabinet is a second cabinet. It is a Linux VM on the mini that runs the same OS, provisioning script, cabinet service, launcher and runtime as the real Pi, and keeps its own cart library, logs, Manager pairing and API identity. From the mini's side it looks exactly like the real cabinet: a host on the network that you reach through the Cabinet Manager (Manager API) and Claude Code (the `arcade` MCP server). It sees none of the mini's files, logins or Claude Code.

```
MAC MINI (macOS 27, Apple M6, 32 GB)
  Cabinet Manager  ──HTTP──┐             Claude Code + game-studio plugin ──MCP──┐
                           │                                                     │
  ─────────────── the mini's own software stops here; only the network crosses ──────────────
                           ▼                                                     ▼
  UTM ▸ Apple Virtualization VM "arcade-virtual"   (4 vCPU, 8 GB, 1024×768, own disk)
    Raspberry Pi OS Lite 64-bit (trixie) + provisioning script, profile `virtual`
    Launcher (kiosk Chromium) ▸ shelf, Make, tiles ▸ house runtime ▸ carts
    Cabinet service ▸ Arcade side (server, git cart library, logs, MCP, Manager API, gate)
                    ▸ Studio side (Managed Agents sessions, tile relay, guardrails)
    Own API identity ──────────────────────────────▶ Claude Managed Agents, Groq
    Inputs: Mac keyboard (D82 keys) · USB mic and gamepad passed through · sound out
```

What the real cabinet does that this one can't, in one line: it runs with the mini switched off. The virtual cabinet shares the mini's hardware, so **its independence is logical, not physical**. Everything else the locked rules require (no mini software in the play or build path, no mini resources used by the cabinet) holds inside the VM. The locked rule for the real cabinet doesn't change (D129).

How it differs from the Cabinet Manager's simulator (D70's local player, which grows into it): the simulator is a quick cart player in a browser on the mini, for iterating on a game. The virtual cabinet is the whole cabinet stack, for testing the cabinet itself and for playing as the kids will.

## The mini, checked 2026-11-07 (local, read-only)

| | |
|---|---|
| Model | Mac mini (Mac18,5), Apple M6, 12 cores (2 Super, 4 Performance, 6 Efficiency) |
| Memory | 32 GB |
| macOS | 27.0 (26A428) |
| Disk | 926 GB data volume, **31 GB free (97% used)**: see question 6 |
| Network | Wi-Fi (`en1`) in use; Ethernet `en0` inactive |
| Audio | Built-in speakers only. **No microphone** (only "Mac mini Speakers" in System Information) |
| VM tools installed | none (no UTM, QEMU, Lima, Tart or Docker) |

## What runs it (D120)

**UTM 5.0.8, using its Apple Virtualization backend** (not its QEMU backend).

| Option | Verdict | Why (checked 2026-11-07) |
|---|---|---|
| **UTM, Apple Virtualization** | **Chosen** | Free and open source (GitHub DMG; App Store copy is identical). v5.0.8 is the latest release (17 Oct). On macOS 27 it passes **USB devices through** to Apple Virtualization VMs, from the GUI and `utmctl`; sound input and output can be enabled separately; networking modes Shared, NAT, Host Only and **Bridged**. Gives a window for the screen and a CLI (`utmctl`) for scripts. |
| QEMU `raspi4b`/`raspi5` (true Pi emulation) | No | There is **no `raspi5` machine**. The newest is `raspi4b` (Cortex-A72), with missing devices (PWM, PCIe MSI). Pure software CPU emulation, so slower and no truer about speed. Pi kernels boot through Pi firmware, which QEMU can't fully mimic. |
| Lima 2.3.0 (VZ) | No | Built for headless dev VMs. Audio output (2.2) and mic capture (2.3, 6 Nov 2026) are new; no USB passthrough; bridging on macOS needs the separate root `socket_vmnet` helper. |
| Tart | No | Built for CI images. Fair-source FSL licence. Its docs don't cover audio or USB passthrough for Linux guests. |
| Our own Swift app on Virtualization.framework | No | Most control, but bridged networking needs Apple's restricted `com.apple.vm.networking` entitlement, and it's a whole app to maintain. UTM already wraps the same framework. |
| Parallels, VMware Fusion | Not needed | Same Apple hypervisor underneath; nothing they add here. |

Why Apple Virtualization rather than UTM's QEMU backend: it's Apple's native hypervisor on Apple silicon, it is the only path with USB passthrough plus virtio sound on macOS 27, and the guest runs at near-native speed (which matters for honest frame-time numbers, see D128).

## The OS, and the script it shares with the Pi (D121, D122)

The real cabinet is stock **Raspberry Pi OS Lite 64-bit, trixie (Debian 13), released 6 Oct 2026, kernel 6.18**, plus our provisioning script (D4). The virtual cabinet uses **the same pinned image file** (checked by SHA-256) and **the same script**.

The catch: the image's kernel (`kernel_2712.img` for the Pi 5) is built for the Pi's own boot firmware and device tree. It won't boot in a generic VM. Raspberry Pi doesn't publish a VM image (its only "PC and Mac" image is the x86 Raspberry Pi Desktop ISO). So:

- **Plan A (try first):** keep the stock image's root filesystem (its userland, packages, Chromium build, systemd setup), and boot it with Debian trixie's generic arm64 kernel and initrd, using UTM's direct Linux boot (uncompressed kernel, `root=/dev/vda2`) or UEFI with GRUB. Same userland as the Pi, different kernel.
- **Plan B (fallback):** a stock Debian trixie arm64 install with Raspberry Pi's apt archive added, so the same Raspberry Pi OS packages (Chromium among them) come from the same place as on the Pi.
- The V0 spike decides, on these checks: boots unattended; `apt` sees the same package versions as the pinned Pi image; our script runs to the end; kiosk Chromium shows the shelf at 1024×768. Plan A wins a tie.

**One script, two hardware profiles** (D122): `picade` and `virtual`. Everything above the hardware is identical and pinned the same way: users, kiosk, Chromium, Node, cabinet service, launcher, players, config. Only the hardware layer differs:

| Step | `picade` (real Pi) | `virtual` |
|---|---|---|
| Kernel | Pi kernel from the image | Debian generic arm64 (Plan A) |
| `config.txt` | `dtoverlay=picade` + D82 `dtparam` keys, `usb_max_current_enable=1`, `dtparam=audio=off`, `vc4-kms-v3d,noaudio` (D83) | not used |
| Controls | Picade overlay built from pinned `pimoroni/picade-hat` | none needed: the VM's USB keyboard already sends the D82 keys |
| Audio device | X HAT I2S DAC | virtio sound |
| Hostname | `arcade` | `arcade-virtual` |
| Firewall | none | refuse new connections to the mini (D124) |
| Guest tools | none | none (no shared folders, no clipboard agent) |

The profile is one config value read by the script, so the Cabinet Manager's update flow (D4) works the same on both. This also makes the virtual cabinet the place to try every script update before it reaches the Pi.

## VM shape (D123)

- **4 vCPUs and 8 GB RAM**, to match the Pi 5 8 GB's four cores and memory (not its speed; see below).
- **32 GB sparse disk** (expect about 8–12 GB used), standing in for the microSD card.
- **One display at 1024×768**, the Picade panel.
- Virtio sound (output, plus input, D127), USB keyboard and pointer, one network card.
- **No shared directories, no clipboard sharing, no Rosetta, no SSH keys from the mini.** Geoff gets in the way he would on the real Pi: the cabinet's own console or SSH with its own key.
- The VM is generated from a script in the repo (`scripts/virtual-cabinet/`, Phase V0); the VM itself and its disk live in UTM's library, outside the repo, so no kid data ever lands in git.

## Fidelity, subsystem by subsystem

| Subsystem | How close | What closes the gap |
|---|---|---|
| **OS and software** | Same image userland, same script, same pins. Kernel differs (generic Debian 4K-page vs the Pi 5's 16K-page `kernel_2712`). | Plan A above; the Pi's kernel is only tested on the Pi. |
| **CPU speed** | Not the Pi's. An M6 core is several times faster than the Pi 5's 2.4 GHz Cortex-A76 (my estimate, not measured). | D128: the gate's frame-time results are labelled `virtual` and judged against a budget scaled by a calibration factor; measure it side by side when the Pi arrives. Optional CPU quota inside the VM. |
| **GPU** | Not the Pi's. The Pi 5 has VideoCore VII (OpenGL ES 3.1, Vulkan 1.3); the VM's virtio display most likely gives Chromium software rendering (check in V0). | Our runtime draws a 256×192 canvas (0.6 ms a frame in headless Chromium, D21), so this matters little. Treat smoothness as unproven until the Pi. |
| **Display, 1024×768** | Exact pixel size. The window is on the mini's monitor, not a 10" IPS panel; no HDMI/EDID. | UTM window at 1024×768 (or an exact 2× on a big monitor), **opened on demand** (D126). The VM runs whether or not the window is open. |
| **Picade controls** | Same key codes reach Chromium: arrows, Z X C V, Q E, Enter, Escape, F1, F2 (D82). Keys only reach the VM while its window has focus, so it never steals the mini's keyboard. | Optional: pass a USB arcade stick or gamepad through to the VM (D125); the real X HAT and overlay are only tested on the Pi. |
| **Power button** | UTM's "stop" sends the guest a power-button request, so it shuts down cleanly, like holding the Picade's button. | The Pi's power-on quirk (issue #45) can't be reproduced. |
| **Audio out** | Same browser audio path (WebAudio → ALSA/PipeWire), different device: virtio sound to the mini's speakers, in stereo. | Optional mono downmix in the `virtual` profile to hear what the 3 W mono speaker will play. Volume and tone only on the real speaker. |
| **Mic and push-to-talk** | The mini has **no built-in mic**. With a USB mic passed through (macOS 27), the VM sees the actual USB device, the same as the Pi will. Push-to-talk is just a key, whatever D86 Q1 decides. | D127: pass the cabinet's own mic through; fallback is the mini's audio input via virtio sound. Basement echo and the cabinet's speaker feedback only on site. |
| **Network and name** | Its own DHCP address on the home mesh, like the Pi, and its own mDNS name `arcade-virtual.local`, so it can run alongside the real `arcade.local` later. | D124: bridged on the mini's Wi-Fi. UTM notes bridging on Wi-Fi "may require additional configuration"; fallback is Shared networking (only the mini can reach it). Basement Wi-Fi strength only on site. |
| **API identity** | Its own, never the mini's `game-studio-arcade` profile. What kind is Geoff's call (D16): see question 2. | Same mechanism as the real cabinet, a separate credential. |
| **Data** | Own cart library, logs, play telemetry, Manager token, all inside the VM's disk. Never deleted (D5); UTM snapshot before each update. | Backups like the real cabinet's (nightly to GitHub, §4). Moving carts to the real cabinet: question 3. |
| **Storage** | A virtual disk on an SSD, much faster than microSD; no sudden-power-loss corruption. | Pi only. |
| **Heat** | None. The Pi under the HAT was reported at ~85 °C and throttling (D83). | Pi only. |

### Plainly, what it can't reproduce

- The Pi 5's CPU and GPU speed, and thermal throttling.
- The Picade X HAT: GPIO, the `picade` overlay and its `dtparam` key map, the I2S DAC and mono amp, the power button's power-on behaviour, `usb_max_current_enable`.
- The Pi's kernel and boot firmware (`config.txt`, EEPROM), and the panel's HDMI/EDID handshake.
- microSD speed and wear; the basement Wi-Fi signal.
- Running with the mini off.
- The feel of a joystick and buttons on a desk cabinet, unless a USB stick is passed through.

## Isolation (D124, D129)

What "isolated from the mini the way the real Pi is" means here, and how each part is enforced:

| Rule | How |
|---|---|
| No access to the mini's files or Claude Code | No shared folders, clipboard, Rosetta or mini keys in the VM config (D123). The VM's disk is its own file. |
| The mini is reached only the way the real cabinet reaches it, which is never | The `virtual` profile's firewall refuses new outbound connections to the mini's addresses. Replies to the mini's own requests (Manager, MCP) still flow. |
| The mini reaches the cabinet only through the network | Cabinet Manager → Manager API, Claude Code → `arcade` MCP at `http://arcade-virtual.local:<port>/mcp` (D7), with its own pairing token. Which cabinet they talk to is one config value (`ARCADE_HOST`). |
| Own API identity | Never the mini's profile (question 2). |
| Desktop builds publish the real way | Claude Code's `publish_cart` goes over MCP and runs the virtual cabinet's publish gate (D8). |
| Kid data stays out of git | The VM, its disk and snapshots live in UTM's library, outside the repo (§15). |

This is isolation for **fidelity**, not security: root in the VM could undo its firewall, and the hypervisor is the real wall. That's the right level for a stand-in cabinet.

## Phased plan

Placed into the build plan (HANDOFF §14). Each step ends with something Geoff can use.

**V0 — a cabinet that plays (smallest useful step; Phase 1 start).**
- Install UTM (GitHub build) via Homebrew. Script `scripts/virtual-cabinet/` that fetches the pinned Pi OS image, makes the disk (Plan A or B, decided here), and creates the UTM VM from D123.
- First cut of the provisioning script with the `virtual` profile: kiosk Chromium + the launcher shell playing the runtime's example carts from the keyboard, sound out, 1024×768.
- Spike checks recorded in platform-notes.md: Plan A boots; Chromium's rendering and frame time in the VM; the window closes and reopens without stopping the VM or grabbing focus; bridged on Wi-Fi gets an address and `arcade-virtual.local`; power-button shutdown.
- *Accept:* from a clean disk, one command gives a VM that boots to the shelf and plays the example carts with sound.

**V1 — the cabinet service (Phase 1 proper).**
- The cabinet service in the VM: local server, git cart library, play log, Manager API, `arcade` MCP, publish gate with D128's labelled frame-time results.
- Cabinet Manager v0 on the mini pairs with it; desktop Claude Code publishes a cart to it over MCP and the cart reaches the shelf.
- *Accept:* a desktop-built cart passes the virtual gate and appears on the shelf; the play shows up in the Manager's Activity.

**V2 — Studio builds from the virtual cabinet (Phase 1 end, needs question 2).**
- The cabinet's own API identity; Managed Agents sessions started from the launcher's Make entry (D86); the tile relay on screen; turns logged to the cart.
- With the mic passed through (D127): the "tell me" screen and Groq transcription, which pulls part of Phase 3 forward.
- *Accept:* a game is made end to end at the virtual cabinet with the keyboard (and the mic, if one is there), and lands on its shelf with its log.

**V3 — when the Picade arrives (Phase 2).**
- The same script with the `picade` profile on the Pi. Only the hardware layer is new work.
- Run the same carts' gate on both and set D128's calibration factor from real numbers.
- Carts move or stay per question 3; the virtual cabinet stays as a staging cabinet or is archived per question 4 (never deleted).

### How this changes the project's phases

- **Phase 0:** unchanged. The CLI driver still plays the cabinet's role.
- **Phase 1:** gets a real target. "Develop the service on the Mac mini or a spare Pi" becomes "develop and run it in the virtual cabinet". Phase 1's check of Playwright's Chromium on Raspberry Pi OS arm64 for the gate can be done in the VM (arm64, same OS), though speed still needs the Pi.
- **Phase 2:** shrinks to hardware bring-up (assembly, overlay and key map, DAC, panel, power button, mic in the case, Wi-Fi in the basement), because the software is already running on the same script.
- **Phase 3:** voice work and first cabinet-style builds can start before the hardware, depending on question 1.
- **Later:** the virtual cabinet can stay as staging, so each software update is tried there before the Manager pushes it to the Pi.

## Costs

- UTM: free (GitHub build).
- Mini resources: 4 cores and 8 GB of 12 cores and 32 GB while it runs; 8–12 GB of disk now (32 GB cap).
- API: a build from the virtual cabinet costs the same as from the real one, and counts against the same phase budgets.
- Hardware: none required. Optional: the cabinet's mic bought early (question 5), a USB arcade stick (question 8).

## Questions for Geoff

1. **Who uses the virtual cabinet?** (a) Geoff only, for testing. (b) Geoff with a kid next to him. (c) A kid alone at the mini. *Lean: (b).* The mini is Geoff's logged-in Mac with Claude Code one window away, and the kids never use Geoff's login solo (§5). The VM itself never has Geoff's login.
2. **The cabinet's API identity** (D16, open; this needs answering by V2, and the virtual cabinet gets its own copy of whichever you choose). The options:
   - (a) A workspace-scoped API key per cabinet, stored on the cabinet. Works on the Individual account today. A long-lived secret on disk; separate keys per cabinet keep costs and revocation separate.
   - (b) Convert the Console account to an organization, unlocking Workload Identity Federation (`scripts/wif/` is ready): per-device identity, 10-minute credentials, no pasted secret.
   - (c) The `ant` CLI browser login on each cabinet, as on the mini. Nothing pasted, but it needs a person to log in, which fits an unattended cabinet badly.
   - Also: should the virtual cabinet have **its own workspace and spend limit**, or share the `game-studio-arcade` workspace's?
3. **Games made on the virtual cabinet:** (a) move to the real cabinet's shelf when it arrives, with their history, or (b) stay on the virtual cabinet as test games. *Lean: (a)*, if the kids make games on it. Nothing is deleted either way.
4. **After the Picade arrives:** (a) keep the virtual cabinet as a staging cabinet, where updates are tried before the Pi, or (b) archive it (disk kept, VM off). *Lean: (a).*
5. **The mic:** buy the cabinet's mic now, so the virtual cabinet uses the same device (the mini has no mic at all). It depends on D84: a USB mic, or the USB audio interface if you go with the XLR gooseneck. *Lean: yes, once D84 is settled.* Without one, voice waits.
6. **Disk space:** the mini has 31 GB free (97% used). The virtual cabinet needs about 8–12 GB now and is capped at 32 GB. (a) Fine as is, (b) free some space first, (c) keep the VM on an external drive. *Lean: (b)*; at 97% the mini itself is close to trouble.
7. **Who on the home network can see it:** (a) bridged, so it's a device on the home Wi-Fi like the real cabinet (any home device could open its pages, as with the real one), or (b) visible only to the mini. *Lean: (a)*, for fidelity.
8. **How it's played:** (a) the Mac keyboard (same keys as the Picade), or (b) also a USB arcade stick passed through, for the feel (a purchase; D85 put external controllers off). *Lean: (a)* for now.

## Sources (checked 2026-11-07)

- UTM releases, v5.0.6–v5.0.8 notes (USB passthrough for Apple Virtualization on macOS 27, separate sound input/output, Shared/NAT/Host Only modes, minimum macOS 12): https://github.com/utmapp/UTM/releases
- UTM docs, Apple Virtualization networking (Shared, NAT, Host Only, Bridged; Wi-Fi bridging caveat): https://docs.getutm.app/settings-apple/devices/network/
- UTM docs, Apple Virtualization boot (UEFI needed for Linux graphics; direct Linux boot with uncompressed kernel, `console=hvc0 root=/dev/vda`): https://docs.getutm.app/settings-apple/boot/
- UTM docs, installation (free GitHub build, identical App Store build): https://docs.getutm.app/installation/macos/
- Apple, `VZUSBPassthroughDevice` (macOS 27.0+): https://developer.apple.com/documentation/virtualization/vzusbpassthroughdevice
- Apple, `VZBridgedNetworkDeviceAttachment` (needs `com.apple.vm.networking`): https://developer.apple.com/documentation/virtualization/vzbridgednetworkdeviceattachment
- Apple, `VZVirtioSoundDeviceConfiguration` and its input stream ("such as from a microphone"): https://developer.apple.com/documentation/virtualization/vzvirtiosounddeviceconfiguration
- QEMU, Raspberry Pi boards (`raspi0`…`raspi4b`, no `raspi5`; missing devices): https://www.qemu.org/docs/master/system/arm/raspi.html
- Raspberry Pi OS downloads (Lite 64-bit, trixie, 6 Oct 2026, kernel 6.18, 525 MB; no VM image): https://www.raspberrypi.com/software/operating-systems/
- Raspberry Pi 5 specs (BCM2712, 2.4 GHz Cortex-A76 ×4, VideoCore VII, GL ES 3.1, Vulkan 1.3): https://www.raspberrypi.com/products/raspberry-pi-5/
- Lima releases (v2.3.0, 6 Nov 2026: VZ mic capture; v2.2.0 virtio sound; bridged only on Linux hosts): https://github.com/lima-vm/lima/releases
- Tart (Virtualization.framework, fair-source licence): https://github.com/openai/tart, https://computingforgeeks.com/install-tart-macos-linux-vms-apple-silicon/
- Pi OS kernel needs Pi boot firmware; generic VM path is a Debian arm64 kernel: https://forum.level1techs.com/t/virtualizing-rpi-on-ampere-ubuntu-24-04-aarch64/225253, https://github.com/utmapp/UTM/discussions/4970

Not verified, checked in V0: that Plan A boots; Chromium's rendering path and frame time inside the VM; that bridging on the mini's Wi-Fi works; that UTM's window can be closed without stopping the VM or taking focus; that a USB audio device passes through cleanly; the access to Raspberry Pi's apt archive (its index returned 403 to a plain web fetch).

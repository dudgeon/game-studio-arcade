// Counts UTM's on-screen windows on the mini. Reads owners and bounds only, so it needs no permission.
// Exit 0 when there are none: Geoff's rule is no windows without his OK (D141).
import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
let utm = windows.filter { ($0[kCGWindowOwnerName as String] as? String) == "UTM" }
print("UTM windows on screen: \(utm.count)")
exit(utm.isEmpty ? 0 : 1)

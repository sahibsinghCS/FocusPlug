import { describe, expect, it } from "vitest";
import { pickCameraDeviceId, type CameraInput } from "./camera";

const droidcam: CameraInput = { deviceId: "droid", label: "DroidCam Video" };
const integrated: CameraInput = { deviceId: "built-in", label: "Integrated Webcam (0c45:6739)" };
const obs: CameraInput = { deviceId: "obs", label: "OBS Virtual Camera" };

describe("pickCameraDeviceId", () => {
  it("swaps a virtual default for the real webcam", () => {
    expect(pickCameraDeviceId([droidcam, integrated], droidcam.label)).toBe("built-in");
    expect(pickCameraDeviceId([obs, droidcam, integrated], obs.label)).toBe("built-in");
  });

  it("keeps a real default, and keeps a virtual camera when it is the only one", () => {
    expect(pickCameraDeviceId([integrated, droidcam], integrated.label)).toBeNull();
    expect(pickCameraDeviceId([droidcam], droidcam.label)).toBeNull();
  });

  it("FOCUSPLUG_CAMERA wins, matched on a label substring", () => {
    expect(pickCameraDeviceId([integrated, droidcam], integrated.label, "droidcam")).toBe("droid");
    expect(pickCameraDeviceId([integrated, droidcam], droidcam.label, "DroidCam")).toBeNull();
    expect(pickCameraDeviceId([integrated, droidcam], droidcam.label, "no such camera")).toBeNull();
  });

  it("does not mistake a real camera name containing 'obs' letters for OBS", () => {
    const real: CameraInput = { deviceId: "cam", label: "Jobsite HD Camera" };
    expect(pickCameraDeviceId([droidcam, real], droidcam.label)).toBe("cam");
  });
});

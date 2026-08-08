using UnityEngine;

namespace Playground
{
    /// <summary>
    /// Development debug overlay (runtime diagnostics).
    /// Shows speed, throttle, steering, grounded, thruster, water state.
    /// </summary>
    public class VehicleDebugHUD : MonoBehaviour
    {
        private PlayerVehicleController _ctrl;
        private Rigidbody _rb;

        private void Start()
        {
            _ctrl = GetComponent<PlayerVehicleController>();
            _rb   = GetComponent<Rigidbody>();
        }

        private void OnGUI()
        {
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, new Vector3(1.4f, 1.4f, 1f));
            GUI.Box(new Rect(10, 10, 270, 185), "DIAGNOSTICS");
            GUILayout.BeginArea(new Rect(20, 35, 250, 160));

            if (InputManager.Instance != null)
                GUILayout.Label($"Input:         {InputManager.Instance.ActiveInputSource}");

            if (_ctrl != null)
            {
                GUILayout.Label($"Throttle:      {_ctrl.CurrentThrottle:F2}");
                GUILayout.Label($"Steering:      {_ctrl.CurrentSteering:F2}");
                GUILayout.Label($"Grounded:      {(_ctrl.IsGrounded  ? "YES" : "NO")}");
                GUILayout.Label($"Thruster:      {(_ctrl.IsThrusting ? "ON"  : "OFF")}");
                GUILayout.Label($"Submerged:     {(_ctrl.IsSubmerged ? "YES" : "NO")}");
            }

            if (_rb != null)
            {
                GUILayout.Label($"Speed:         {_rb.linearVelocity.magnitude:F1} m/s");
                GUILayout.Label($"Vertical:      {_rb.linearVelocity.y:F1} m/s");
            }

            GUILayout.EndArea();
        }
    }
}

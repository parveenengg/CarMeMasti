using UnityEngine;

namespace Playground
{
    /// <summary>
    /// Scene bootstrap: spawns vehicle on terrain via downward raycast,
    /// wires camera follow, ensures singletons exist.
    /// </summary>
    public class PlaygroundBootstrap : MonoBehaviour
    {
        [Header("Spawn")]
        public Transform playerSpawnPoint;
        public GameObject playerVehicle;
        public CameraFollow mainCamera;

        private void Awake()
        {
            Time.timeScale = 1f;
            // Ensure singletons are alive
            _ = InputManager.Instance;
            _ = SettingsManager.Instance;
        }

        private void Start()
        {
            SpawnVehicle();
            WireCamera();
        }

        private void SpawnVehicle()
        {
            if (playerVehicle == null)
                playerVehicle = GameObject.Find("PlayerVehicle");

            if (playerSpawnPoint == null)
            {
                GameObject sp = GameObject.Find("PlayerSpawnPoint");
                if (sp != null) playerSpawnPoint = sp.transform;
            }

            if (playerVehicle == null) return;

            Vector3    pos = playerSpawnPoint != null ? playerSpawnPoint.position : new Vector3(0f, 10f, -40f);
            Quaternion rot = playerSpawnPoint != null ? playerSpawnPoint.rotation : Quaternion.Euler(0f, 90f, 0f);

            // Snap to terrain surface
            if (Physics.Raycast(pos + Vector3.up * 25f, Vector3.down, out RaycastHit hit, 60f))
                pos.y = hit.point.y + 0.6f;

            playerVehicle.transform.SetPositionAndRotation(pos, rot);

            Rigidbody rb = playerVehicle.GetComponent<Rigidbody>();
            if (rb != null) { rb.linearVelocity = Vector3.zero; rb.angularVelocity = Vector3.zero; }

            Debug.Log($"[Playground] Vehicle spawned at Y={pos.y:F2}");
        }

        private void WireCamera()
        {
            if (mainCamera == null && Camera.main != null)
                mainCamera = Camera.main.GetComponent<CameraFollow>();

            if (mainCamera != null && playerVehicle != null)
                mainCamera.target = playerVehicle.transform;
        }
    }
}

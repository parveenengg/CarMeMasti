using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using System.Collections.Generic;

namespace Playground.Editor
{
    /// <summary>
    /// One-click Playground scene generator.
    /// Menu: Playground → Generate Playground Scene
    /// Creates: Terrain, Water, Road loop, Trees, PlayerVehicle, Camera, UI, Managers.
    /// </summary>
    public static class PlaygroundGenerator
    {
        [MenuItem("Playground/Generate Playground Scene")]
        public static void Generate()
        {
            // ── Create / clean scene ─────────────────────────────────────────
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            Shader urpLit = Shader.Find("Universal Render Pipeline/Lit")
                         ?? Shader.Find("Universal Render Pipeline/Unlit")
                         ?? Shader.Find("Standard");

            // ── Directional Light ────────────────────────────────────────────
            GameObject lightGO = new GameObject("Directional Light");
            Light light = lightGO.AddComponent<Light>();
            light.type      = LightType.Directional;
            light.color     = new Color(1f, 0.95f, 0.85f);
            light.intensity = 1.3f;
            light.shadows   = LightShadows.Soft;
            lightGO.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // ── Terrain ──────────────────────────────────────────────────────
            TerrainData tData = new TerrainData();
            tData.size = new Vector3(250f, 30f, 250f);
            tData.heightmapResolution = 129;

            float[,] heights = new float[129, 129];
            for (int y = 0; y < 129; y++)
            for (int x = 0; x < 129; x++)
            {
                float d = Vector2.Distance(new Vector2(x, y), new Vector2(64, 64)) / 64f;
                float island = Mathf.Clamp01(1f - Mathf.Pow(d, 1.8f));

                float riverFactor = 1f;
                if (x >= 45 && x <= 75)
                {
                    float rd = Mathf.Abs(x - 60) / 15f;
                    riverFactor = Mathf.SmoothStep(0.2f, 1f, rd);
                }

                float mtNoise = Mathf.PerlinNoise(x * 0.08f, y * 0.08f) * 0.6f;
                float mtZone  = y > 75 ? Mathf.Clamp01((y - 75) / 50f) * 0.7f : 0f;
                heights[y, x] = Mathf.Clamp01(island * 0.25f * riverFactor + mtZone * mtNoise);
            }
            tData.SetHeights(0, 0, heights);

            GameObject terrainGO = Terrain.CreateTerrainGameObject(tData);
            terrainGO.name = "Terrain";
            terrainGO.transform.position = new Vector3(-125f, 0f, -125f);
            Terrain terrain = terrainGO.GetComponent<Terrain>();
            Material terrainMat = new Material(urpLit);
            terrainMat.color = new Color(0.33f, 0.63f, 0.28f);
            terrain.materialTemplate = terrainMat;

            // ── Water ────────────────────────────────────────────────────────
            GameObject water = GameObject.CreatePrimitive(PrimitiveType.Plane);
            water.name = "WaterBoundary";
            water.transform.position   = new Vector3(0f, 2.5f, 0f);
            water.transform.localScale = new Vector3(30f, 1f, 30f);
            Material waterMat = new Material(urpLit);
            waterMat.color = new Color(0.15f, 0.50f, 0.85f, 0.75f);
            water.GetComponent<Renderer>().material = waterMat;
            Object.DestroyImmediate(water.GetComponent<Collider>());

            // ── Road loop ────────────────────────────────────────────────────
            GameObject roadRoot = new GameObject("RoadNetwork");
            Material roadMat = new Material(urpLit);
            roadMat.color = new Color(0.20f, 0.22f, 0.25f);

            Vector3[] corners = {
                new Vector3(-40f, 0f, -40f), new Vector3(40f, 0f, -40f),
                new Vector3(40f,  0f,  40f), new Vector3(-40f, 0f, 40f)
            };

            for (int i = 0; i < corners.Length; i++)
            {
                Vector3 start = corners[i];
                Vector3 end   = corners[(i + 1) % corners.Length];
                Vector3 mid   = (start + end) * 0.5f;
                float   len   = (end - start).magnitude;

                GameObject seg = GameObject.CreatePrimitive(PrimitiveType.Cube);
                seg.name = $"Road_{i}";
                seg.transform.SetParent(roadRoot.transform);
                seg.transform.position   = mid + Vector3.up * 0.15f;
                seg.transform.rotation   = Quaternion.LookRotation(end - start);
                seg.transform.localScale = new Vector3(8f, 0.08f, len);

                // Snap road to terrain height
                if (Physics.Raycast(mid + Vector3.up * 30f, Vector3.down, out RaycastHit rHit, 60f))
                {
                    Vector3 p = seg.transform.position;
                    p.y = rHit.point.y + 0.04f;
                    seg.transform.position = p;
                }
                seg.GetComponent<Renderer>().material = roadMat;
            }

            // ── Spawn Point ──────────────────────────────────────────────────
            Vector3 spawnPos = new Vector3(0f, 20f, -40f);
            if (Physics.Raycast(spawnPos + Vector3.up * 20f, Vector3.down, out RaycastHit spawnHit, 80f))
                spawnPos.y = spawnHit.point.y + 0.3f;
            spawnPos.y = Mathf.Max(spawnPos.y, 3.5f);

            GameObject spawnGO = new GameObject("PlayerSpawnPoint");
            spawnGO.transform.position = spawnPos;
            spawnGO.transform.rotation = Quaternion.Euler(0f, 90f, 0f);

            // ── Trees ────────────────────────────────────────────────────────
            GameObject treeRoot = new GameObject("EnvironmentProps");
            Material trunkMat   = new Material(urpLit); trunkMat.color = new Color(0.40f, 0.25f, 0.15f);
            Material foliageMat = new Material(urpLit); foliageMat.color = new Color(0.18f, 0.52f, 0.22f);

            Random.InitState(42);
            List<Vector3> placed = new List<Vector3>();
            for (int attempt = 0; attempt < 400 && placed.Count < 35; attempt++)
            {
                float cx = Random.Range(-95f, 95f);
                float cz = Random.Range(-95f, 95f);
                Vector3 candidate = new Vector3(cx, 30f, cz);

                if (!Physics.Raycast(candidate, Vector3.down, out RaycastHit th, 60f)) continue;
                if (th.point.y < 3.2f) continue;

                Vector3 pos = th.point;
                if (Vector3.Distance(pos, spawnPos) < 18f) continue;

                bool roadClose = false;
                for (int r = 0; r < corners.Length; r++)
                {
                    Vector3 rm = (corners[r] + corners[(r + 1) % corners.Length]) * 0.5f;
                    if (Vector3.Distance(pos, rm) < 14f) { roadClose = true; break; }
                }
                if (roadClose) continue;

                bool tooClose = false;
                foreach (var p in placed)
                    if (Vector3.Distance(p, pos) < 6f) { tooClose = true; break; }
                if (tooClose) continue;

                placed.Add(pos);

                float scale = Random.Range(0.8f, 1.5f);

                // Trunk
                GameObject trunk = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                trunk.name = $"Tree_Trunk_{placed.Count}";
                trunk.transform.SetParent(treeRoot.transform);
                trunk.transform.position   = pos + Vector3.up * (1.2f * scale);
                trunk.transform.localScale = new Vector3(0.28f * scale, 1.2f * scale, 0.28f * scale);
                trunk.GetComponent<Renderer>().material = trunkMat;

                // Foliage
                GameObject foliage = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                foliage.name = $"Tree_Foliage_{placed.Count}";
                foliage.transform.SetParent(treeRoot.transform);
                foliage.transform.position   = pos + Vector3.up * (3.2f * scale);
                foliage.transform.localScale = Vector3.one * (2.4f * scale);
                foliage.GetComponent<Renderer>().material = foliageMat;
                Object.DestroyImmediate(foliage.GetComponent<Collider>());
            }

            // ── Player Vehicle ───────────────────────────────────────────────
            GameObject vehicle = GameObject.CreatePrimitive(PrimitiveType.Cube);
            vehicle.name = "PlayerVehicle";
            vehicle.tag  = "Player";
            vehicle.transform.position   = spawnPos + Vector3.up * 0.8f;
            vehicle.transform.rotation   = Quaternion.Euler(0f, 90f, 0f);
            vehicle.transform.localScale = new Vector3(2f, 1f, 4f);

            Material vehicleMat = new Material(urpLit);
            vehicleMat.color = new Color(0.85f, 0.46f, 0.02f);
            vehicle.GetComponent<Renderer>().material = vehicleMat;

            vehicle.AddComponent<PlayerVehicleController>();
            vehicle.AddComponent<VehicleDebugHUD>();

            // ── Main Camera ──────────────────────────────────────────────────
            GameObject camGO = new GameObject("Main Camera");
            camGO.tag = "MainCamera";
            Camera cam = camGO.AddComponent<Camera>();
            cam.backgroundColor = new Color(0.55f, 0.75f, 0.95f);
            cam.clearFlags = CameraClearFlags.SolidColor;
            camGO.AddComponent<AudioListener>();
            CameraFollow camFollow = camGO.AddComponent<CameraFollow>();
            camFollow.target = vehicle.transform;
            camGO.transform.position = new Vector3(0f, 12f, -18f);
            camGO.transform.LookAt(vehicle.transform);

            // ── Managers ─────────────────────────────────────────────────────
            GameObject managers = new GameObject("_Managers");

            GameObject gmGO = new GameObject("GameManager");
            gmGO.transform.SetParent(managers.transform);
            gmGO.AddComponent<GameManager>();

            GameObject amGO = new GameObject("AudioManager");
            amGO.transform.SetParent(managers.transform);
            amGO.AddComponent<AudioManager>();

            GameObject smGO = new GameObject("ScoreManager");
            smGO.transform.SetParent(managers.transform);
            smGO.AddComponent<ScoreManager>();

            GameObject boot = new GameObject("PlaygroundBootstrap");
            boot.transform.SetParent(managers.transform);
            PlaygroundBootstrap bs = boot.AddComponent<PlaygroundBootstrap>();
            bs.playerVehicle    = vehicle;
            bs.mainCamera       = camFollow;

            // ── Mobile Controls Canvas ───────────────────────────────────────
            BuildMobileControls();

            // ── Save scene ───────────────────────────────────────────────────
            string scenePath = "Assets/Scenes/Playground.unity";
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, scenePath);
            AssetDatabase.Refresh();

            Debug.Log($"[PlaygroundGenerator] Done! Saved to {scenePath}");
            EditorUtility.DisplayDialog("Playground Generated", $"Scene saved to:\n{scenePath}\n\nPress Play to drive!", "OK");
        }

        // ── Mobile HUD ───────────────────────────────────────────────────────

        private static void BuildMobileControls()
        {
            // Canvas
            GameObject canvasGO = new GameObject("MobileControlsCanvas");
            Canvas canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 10;
            canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>().uiScaleMode =
                UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();

            // Joystick background (left side)
            GameObject joyBg = CreatePanel(canvasGO, "JoystickBg",
                new Vector2(0f, 0f), new Vector2(0f, 0f),
                new Vector2(60f, 60f), new Vector2(200f, 200f),
                new Color(1,1,1,0.12f));

            // Gas button (bottom right)
            CreateButton(canvasGO, "GasButton", "GO",
                new Vector2(1f, 0f), new Vector2(1f, 0f),
                new Vector2(-80f, 80f), new Vector2(120f, 120f),
                new Color(0.2f, 0.85f, 0.3f, 0.85f));

            // Brake button
            CreateButton(canvasGO, "BrakeButton", "BRAKE",
                new Vector2(1f, 0f), new Vector2(1f, 0f),
                new Vector2(-220f, 80f), new Vector2(120f, 120f),
                new Color(0.85f, 0.2f, 0.2f, 0.85f));

            // Jump button
            CreateButton(canvasGO, "JumpButton", "JUMP",
                new Vector2(1f, 0f), new Vector2(1f, 0f),
                new Vector2(-150f, 220f), new Vector2(120f, 120f),
                new Color(0.2f, 0.4f, 0.95f, 0.85f));

            // Settings button (top right)
            CreateButton(canvasGO, "SettingsButton", "⚙",
                new Vector2(1f, 1f), new Vector2(1f, 1f),
                new Vector2(-30f, -30f), new Vector2(60f, 60f),
                new Color(1f, 1f, 1f, 0.5f));

            // Mute button (top right, below settings)
            CreateButton(canvasGO, "MuteButton", "🔊",
                new Vector2(1f, 1f), new Vector2(1f, 1f),
                new Vector2(-30f, -100f), new Vector2(60f, 60f),
                new Color(1f, 1f, 1f, 0.5f));
        }

        private static GameObject CreatePanel(GameObject parent, string name,
            Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPos, Vector2 size, Color color)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            UnityEngine.UI.Image img = go.AddComponent<UnityEngine.UI.Image>();
            img.color = color;
            RectTransform rt = go.GetComponent<RectTransform>();
            rt.anchorMin    = anchorMin;
            rt.anchorMax    = anchorMax;
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta    = size;
            return go;
        }

        private static GameObject CreateButton(GameObject parent, string name, string label,
            Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPos, Vector2 size, Color color)
        {
            GameObject go = CreatePanel(parent, name, anchorMin, anchorMax, anchoredPos, size, color);

            // Round look via image
            UnityEngine.UI.Image img = go.GetComponent<UnityEngine.UI.Image>();
            img.raycastTarget = true;

            // Label
            GameObject textGO = new GameObject("Label");
            textGO.transform.SetParent(go.transform, false);
            var textComp = textGO.AddComponent<TMPro.TextMeshProUGUI>();
            textComp.text      = label;
            textComp.alignment = TMPro.TextAlignmentOptions.Center;
            textComp.color     = Color.white;
            textComp.fontSize  = 22f;
            RectTransform tr = textGO.GetComponent<RectTransform>();
            tr.anchorMin = Vector2.zero; tr.anchorMax = Vector2.one;
            tr.offsetMin = Vector2.zero; tr.offsetMax = Vector2.zero;

            go.AddComponent<UnityEngine.UI.Button>();
            return go;
        }
    }
}

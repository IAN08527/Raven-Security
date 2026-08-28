import json
import os

GOLDEN = {
    "narrative": [
        "Rakesh Sawant / R. Sawant collapse via shared NAFIS id",
        "CDR call spike between syndicate A and B 36h before incident",
        "Structuring: 6x Rs 49,500 from syndicate B to kingpin cousin mule",
        "Macro graph reveals kingpin via betweenness (degree 3, centrality 0.41)",
        "CCTV cam_01 -> cam_02 -> cam_04 topology handoff tracking",
        "Tamper one FIR blob -> graph greys out, red shield fires",
    ],
    "case_code": "OP-RAVEN-01",
}


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "assets", "synthetic", "golden_path.json")
    with open(out, "w") as f:
        json.dump(GOLDEN, f, indent=2)
    print("golden path written", out)


if __name__ == "__main__":
    main()

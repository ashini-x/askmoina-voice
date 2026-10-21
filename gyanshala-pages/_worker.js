/**
 * Gyanshala Pages front door.
 *
 * This Pages Advanced Mode Worker forwards every request to the existing
 * Gyanshala application Worker. Configure a Pages Service binding:
 *   Variable name: GYANSHALA_WORKER
 *   Service: gyanshala-smart-supply-api
 *
 * The downstream Worker continues to serve the Gyanshala UI and /api/* routes,
 * so sessions and APIs stay on the assigned Pages origin.
 */
export default {
  async fetch(request, env) {
    const worker = env.GYANSHALA_WORKER;
    if (!worker || typeof worker.fetch !== "function") {
      return new Response(
        "Gyanshala Pages is not connected to its application Worker yet. Add the GYANSHALA_WORKER service binding and redeploy.",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return worker.fetch(request);
  },
};

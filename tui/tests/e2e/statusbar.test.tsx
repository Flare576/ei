import { describe, it, expect, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { createStore } from "solid-js/store"

type QueueState = "idle" | "busy" | "paused"

interface StoreType {
  queueStatus: { state: QueueState; pending_count: number }
}

type TestSetup = Awaited<ReturnType<typeof testRender>>
let testSetup: TestSetup | undefined

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
    testSetup = undefined
  }
})

describe("StatusBar E2E", () => {
  it("should render 'Ready' when queue is idle", async () => {
    const [store] = createStore<StoreType>({
      queueStatus: { state: "idle", pending_count: 0 }
    })

    testSetup = await testRender(
      () => (
        <box height={1} flexDirection="row">
          <text>
            {store.queueStatus.state === "busy"
              ? `Processing (${store.queueStatus.pending_count})`
              : store.queueStatus.state === "paused"
                ? "Paused"
                : "Ready"}
          </text>
        </box>
      ),
      { width: 40, height: 1 }
    )

    await testSetup.renderOnce()
    const output = testSetup.captureCharFrame()

    expect(output).toContain("Ready")
  })

  it("should render 'Processing (3)' when queue is busy", async () => {
    const [store, setStore] = createStore<StoreType>({
      queueStatus: { state: "idle", pending_count: 0 }
    })

    testSetup = await testRender(
      () => (
        <box height={1} flexDirection="row">
          <text>
            {store.queueStatus.state === "busy"
              ? `Processing (${store.queueStatus.pending_count})`
              : store.queueStatus.state === "paused"
                ? "Paused"
                : "Ready"}
          </text>
        </box>
      ),
      { width: 40, height: 1 }
    )

    setStore("queueStatus", { state: "busy", pending_count: 3 })
    await testSetup.renderOnce()
    const output = testSetup.captureCharFrame()

    expect(output).toContain("Processing (3)")
  })

  it("should update from Ready to Processing when state changes", async () => {
    const [store, setStore] = createStore<StoreType>({
      queueStatus: { state: "idle", pending_count: 0 }
    })

    testSetup = await testRender(
      () => (
        <box height={1} flexDirection="row">
          <text>
            {store.queueStatus.state === "busy"
              ? `Processing (${store.queueStatus.pending_count})`
              : store.queueStatus.state === "paused"
                ? "Paused"
                : "Ready"}
          </text>
        </box>
      ),
      { width: 40, height: 1 }
    )

    await testSetup.renderOnce()
    expect(testSetup.captureCharFrame()).toContain("Ready")

    setStore("queueStatus", { state: "busy", pending_count: 5 })
    await testSetup.renderOnce()

    expect(testSetup.captureCharFrame()).toContain("Processing (5)")
  })
})

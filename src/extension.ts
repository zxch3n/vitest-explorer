import * as vscode from 'vscode'
import { TestFile, WEAKMAP_TEST_DATA } from './TestData'
import { testControllerId } from './config'
import { TestFileDiscoverer } from './discover'
import { log } from './log'
import { openTestTag } from './tags'
import type { VitestAPI } from './api'
import { resolveVitestAPI, resolveVitestFoldersMeta } from './api'
import { GlobalTestRunner } from './runner/runner'

// TODO: more error handling for lazy loaded API
export async function activate(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders || []

  if (!folders.length) {
    log.info('The Vitest extension is not activated because no workspace folder was detected.')
    return
  }

  const start = performance.now()
  const meta = resolveVitestFoldersMeta(folders)

  if (!meta.length) {
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

  // we know Vitest is installed, so we can create a test controller
  const ctrl = vscode.tests.createTestController(testControllerId, 'Vitest')

  context.subscriptions.push(ctrl)

  // start discover spinner as soon as possible, so we await it only when accessed
  const api = resolveVitestAPI(meta).then((api) => {
    const end = performance.now()
    log.info('[API]', `Vitest API resolved in ${end - start}ms`)
    context.subscriptions.push(api)
    return api
  })

  // TODO: check compatibility with version >= 0.34.0(?)
  // const workspaceConfigs = await getVitestWorkspaceConfigs()
  // // enable run/debug/watch tests only if vitest version >= 0.12.0
  // if (!workspacesCompatibilityCheck(workspaceConfigs)) {
  //   const msg = 'Because Vitest version < 0.12.0 for every workspace folder, run/debug/watch tests from Vitest extension disabled.\n'
  //   log.error(msg)
  //   // if the vitest detection is false positive, we may still reach here.
  //   // but we can still use `.version` to filter some false positive
  //   if (workspaceConfigs.some(x => x.isUsingVitestForSure))
  //     vscode.window.showWarningMessage(msg)

  // context.subscriptions.push(
  //   vscode.commands.registerCommand(Command.UpdateSnapshot, () => {
  //     vscode.window.showWarningMessage(msg)
  //   }),
  // )

  //   return
  // }

  const fileDiscoverer = registerDiscovery(ctrl, api).then((discoverer) => {
    context.subscriptions.push(discoverer)
    discoverer.discoverAllTestFilesInWorkspace(ctrl)
    return discoverer
  })
  const runner = (async () => new GlobalTestRunner(await api, ctrl))().then((runner) => {
    context.subscriptions.push(runner)
    return runner
  })

  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    async (request, token) => (await runner).runTests(request, token),
    true,
    undefined,
    true,
  )

  ctrl.createRunProfile(
    'Debug Tests',
    vscode.TestRunProfileKind.Debug,
    async (request, token) => (await runner).debugTests(request, token),
    false,
    undefined,
    true,
  )

  context.subscriptions.push(
    ctrl,
    // vscode.commands.registerCommand(Command.UpdateSnapshot, (test) => {
    //   updateSnapshot(ctrl, fileDiscoverer, test)
    // }),
    vscode.workspace.onDidOpenTextDocument(async (e) => {
      (await fileDiscoverer).discoverTestFromDoc(ctrl, e)
    }),
    vscode.workspace.onDidCloseTextDocument(async (e) => {
      const item = await (await fileDiscoverer).discoverTestFromDoc(ctrl, e)
      if (item)
        item.tags = item.tags.filter(x => x !== openTestTag)
    }),
    vscode.workspace.onDidChangeTextDocument(async e =>
      (await fileDiscoverer).discoverTestFromDoc(ctrl, e.document),
    ),
    // TODO: update when workspace folder is added/removed
  )

  await api
}

function registerDiscovery(ctrl: vscode.TestController, api: Promise<VitestAPI>) {
  const fileDiscoverer = (async () => new TestFileDiscoverer(await api))()
  // run on refreshing test list
  ctrl.refreshHandler = async () => {
    await (await fileDiscoverer).discoverAllTestFilesInWorkspace(ctrl)
  }

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      // item == null, when user opened the testing panel
      // in this case, we should discover and watch all the testing files
      await (await fileDiscoverer).watchTestFilesInWorkspace(ctrl)
    }
    else {
      const data = WEAKMAP_TEST_DATA.get(item)
      if (data instanceof TestFile)
        await data.updateFromDisk(ctrl)
    }
  }

  vscode.window.visibleTextEditors.forEach(async x =>
    (await fileDiscoverer).discoverTestFromDoc(ctrl, x.document),
  )

  return fileDiscoverer
}

// export function deactivate() {}

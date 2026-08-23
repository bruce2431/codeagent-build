/**
 * GatewayControlBridge.tsx —— 网关模型/思考等级控制消息的 REPL 侧处理器（2026-08-22）。
 *
 * 在 replLauncher 的 <REPL> 旁挂载（AppStateProvider 之下）。挂载时注册全局 handler，
 * gatewayClient 收到网关按会话路由的 {type:'model'|'effort'} 后 invoke，这里落地到真实 CLI 状态：
 *  - model  → 每会话覆盖（官方 onSetModel 语义）：setMainLoopModelOverride(resolved ?? undefined)
 *    + setAppState({ mainLoopModelForSession: resolved })，'default'/null → undefined 清除覆盖，
 *    回落读盘 getActiveModel()（凭据池）——只影响本会话，不写全局凭据池。
 *  - effort → setAppState({ effortValue })
 * 与官方 useReplBridge.onSetModel/onSetMaxThinkingTokens 同一套语义；卸载时清空 handler。
 */
import { useEffect } from 'react'
import { setMainLoopModelOverride } from '../bootstrap/state.js'
import { setControlOverrideHandle } from '../bridge/controlOverrideHandle.js'
import { useSetAppState } from '../state/AppState.js'

export function GatewayControlBridge(): null {
  const setAppState = useSetAppState()
  useEffect(() => {
    setControlOverrideHandle((kind, value) => {
      if (kind === 'model') {
        const resolved = value == null || value === 'default' ? null : String(value)
        // 每会话覆盖（官方 onSetModel 语义）：setMainLoopModelOverride 更新模块级 STATE（getMainLoopModel
        // 实际 API 调用用），mainLoopModelForSession 更新 UI 显示；'default'/null 映射到 undefined（清除覆盖）
        // 而非官方 null——Pj16 模型源=凭据池，null 会让 getMainLoopModel 落到内置默认而非 getActiveModel()。
        setMainLoopModelOverride(resolved ?? undefined)
        setAppState(prev =>
          prev.mainLoopModelForSession === resolved
            ? prev
            : { ...prev, mainLoopModelForSession: resolved },
        )
      } else if (kind === 'effort') {
        const v = value == null || value === 'auto' ? undefined : String(value)
        setAppState(prev => (prev.effortValue === v ? prev : { ...prev, effortValue: v }))
      }
    })
    return () => setControlOverrideHandle(null)
  }, [setAppState])
  return null
}

const { createApp, ref, computed, onMounted, nextTick, watch, provide, inject } = Vue;
const socket = io();
const SESSION_KEY = 'rpg-session';

// Componentes definidos antes do app principal
const GmConfig = {
    template: `
        <div class="space-y-4">
                <div class="mb-4">
                <h3 class="font-bold mb-3 text-sm text-gray-400">Estrutura da Ficha (3 Seções)</h3>
                <div class="space-y-4">
                    <div v-for="sec in sections" :key="sec.id" class="bg-gray-900 p-4 rounded-lg border border-gray-700">
                        <div class="flex justify-between items-center mb-3">
                                <div>
                                    <div class="text-sm font-semibold text-gray-200">{{ sec.title }}</div>
                                <div class="text-xs text-gray-400">{{ sec.fields.length }} campos</div>
                                </div>
                            <button @click="addField(sec.id)" class="text-xs bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded transition-colors">
                                <i class="fas fa-plus mr-1"></i>Campo
                            </button>
                            </div>
                        <div v-if="sec.fields.length === 0" class="text-xs text-gray-500 italic mb-2">Nenhum campo</div>
                        <div v-for="(field, idx) in sec.fields" :key="sec.id + '-' + idx" class="flex flex-col sm:flex-row gap-2 mb-2 items-stretch sm:items-center">
                                <input v-model="field.name" class="flex-1 min-w-0 p-2 bg-gray-700 rounded text-sm text-white" placeholder="Nome">
                                <select v-model="field.type" class="w-28 sm:w-32 flex-shrink-0 p-2 bg-gray-700 rounded text-sm text-white">
                                    <option value="text">Texto</option>
                                    <option value="number">Número</option>
                                    <option value="longtext">Área</option>
                                </select>
                                <button @click="removeField(sec.id, idx)" class="ml-auto sm:ml-0 mt-1 sm:mt-0 inline-flex items-center justify-center p-2 bg-red-700 hover:bg-red-600 rounded text-white text-sm" aria-label="Remover campo">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            <button @click="saveSchema" class="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-lg text-white font-semibold transition-colors">
                <i class="fas fa-save mr-2"></i>Salvar Estrutura
            </button>
            </div>
    `,
    setup() {
        return {
            sections: inject('sections'),
            addField: inject('addField'),
            removeField: inject('removeField'),
            saveSchema: inject('saveSchema')
        };
    }
};

const PlayerSheet = {
    template: `
        <div class="space-y-4">
                <div class="mb-4">
                    <h3 class="font-bold text-sm text-gray-400 mb-2">Avatar</h3>
                    <div class="flex items-center gap-3">
                    <div class="w-20 h-20 bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
                            <img v-if="sheetData['Avatar']" :src="sheetData['Avatar']" class="w-full h-full object-cover avatar-small">
                            <i v-else class="fas fa-user text-3xl text-gray-500"></i>
                        </div>
                        <div class="flex-1">
                        <input type="file" accept="image/*" @change="handleAvatarFile" class="text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700">
                        <p class="text-xs text-gray-500 mt-1">Envie uma imagem</p>
                        </div>
                    </div>
                </div>
                <div v-for="sec in sections" :key="sec.id" class="mb-4">
                    <h4 class="text-sm font-semibold text-gray-300 mb-2">{{ sec.title }}</h4>
                <div v-if="sec.fields.length === 0" class="text-xs text-gray-500 italic mb-2">Sem campos</div>
                <div v-for="(field, idx) in sec.fields" :key="sec.id+'-'+idx" class="mb-3">
                        <label class="block text-sm text-gray-400 mb-1">{{ field.name }}</label>
                    <input 
                        v-if="field.type !== 'longtext'" 
                        :type="field.type" 
                        v-model="sheetData[field.name]" 
                        @change="saveSheet" 
                        class="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                    <textarea 
                        v-else 
                        v-model="sheetData[field.name]" 
                        @change="saveSheet" 
                        class="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 text-white h-24 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    ></textarea>
                    </div>
                </div>
            <div v-if="sections.reduce((acc,s)=>acc + s.fields.length, 0) === 0" class="text-gray-500 italic text-center py-8">
                <i class="fas fa-info-circle text-2xl mb-2"></i>
                <p>O mestre ainda não definiu a ficha</p>
            </div>
        </div>
    `,
    setup() {
        return {
            sections: inject('sections'),
            sheetData: inject('sheetData'),
            handleAvatarFile: inject('handleAvatarFile'),
            saveSheet: inject('saveSheet')
        };
    }
};

const PlayerInventory = {
    template: `
        <div class="space-y-4">
            <div class="flex items-center justify-between mb-4">
                <h3 class="font-bold text-lg text-yellow-400">
                    <i class="fas fa-backpack mr-2"></i>Meu Inventário
                </h3>
                <button 
                    @click="showCreateItemModal = true" 
                    class="bg-yellow-600 hover:bg-yellow-700 px-3 py-2 rounded-lg text-white text-sm font-semibold transition-colors"
                >
                    <i class="fas fa-plus mr-1"></i>Novo Item
                </button>
            </div>

            <div v-if="inventory.length === 0" class="text-center py-8 text-gray-500">
                <i class="fas fa-box-open text-4xl mb-3"></i>
                <p>Seu inventário está vazio</p>
                <p class="text-sm mt-2">Crie um item ou adicione itens do quadro do mestre</p>
            </div>

            <div v-else class="grid grid-cols-1 gap-3">
                <div 
                    v-for="(item, idx) in inventory" 
                    :key="idx" 
                    class="bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-yellow-600 transition-colors"
                >
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                            <h4 class="font-bold text-yellow-300 mb-1">{{ item.name || 'Item sem nome' }}</h4>
                            <p class="text-sm text-gray-300 mb-2">{{ item.desc || 'Sem descrição' }}</p>
                        </div>
                        <button 
                            @click="editItem(idx)" 
                            class="ml-2 text-gray-400 hover:text-yellow-400 transition-colors"
                        >
                            <i class="fas fa-edit"></i>
                        </button>
                        <button 
                            @click="removeItem(idx)" 
                            class="ml-2 text-gray-400 hover:text-red-400 transition-colors"
                        >
                            <i class="fas fa-trash"></i>
                        </button>
                                </div>
                    <div v-if="item.image" class="mb-2">
                        <img :src="item.image" class="max-w-full rounded-lg" @error="handleImageError">
                            </div>
                    <div v-if="item.attributes && Object.keys(item.attributes).length > 0" class="mb-2">
                        <div class="text-xs text-gray-400 space-y-1">
                            <div v-for="(val, attr) in item.attributes" :key="attr">
                                <strong>{{ attr }}:</strong> {{ val }}
                        </div>
                        </div>
                    </div>
                    <div v-if="item.notes" class="text-xs text-gray-400 italic mt-2">
                        <strong>Notas:</strong> {{ item.notes }}
                    </div>
                </div>
            </div>

            <!-- Create/Edit Item Modal -->
            <div v-if="showCreateItemModal || editingItemIndex !== null" class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4" @click.self="closeItemModal">
                <div class="bg-gray-800 rounded-xl p-6 w-full max-w-md slide-in max-h-[90vh] overflow-y-auto">
                    <h3 class="font-bold text-xl mb-4 text-white">
                        <i class="fas fa-gem mr-2"></i>{{ editingItemIndex !== null ? 'Editar Item' : 'Criar Item' }}
                    </h3>
                    <div class="space-y-4">
                        <input 
                            v-model="currentItem.name" 
                            placeholder="Nome do Item" 
                            class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400"
                        >
                        <textarea 
                            v-model="currentItem.desc" 
                            placeholder="Descrição" 
                            class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 h-24"
                        ></textarea>
                        <input 
                            v-model="currentItem.image" 
                            placeholder="URL da Imagem (opcional)" 
                            class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400"
                        >
                            <div>
                            <label class="block text-sm text-gray-400 mb-2">Atributos (opcional)</label>
                            <div v-for="(val, attr) in currentItem.attributes" :key="attr" class="flex gap-2 mb-2">
                                <input 
                                    v-model="attrNames[attr]" 
                                    placeholder="Nome do atributo" 
                                    class="flex-1 p-2 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 text-sm"
                                    @input="updateAttributeName(attr, $event.target.value)"
                                >
                                <input 
                                    v-model="currentItem.attributes[attr]" 
                                    placeholder="Valor" 
                                    class="flex-1 p-2 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 text-sm"
                                >
                                <button @click="removeAttribute(attr)" class="text-red-400 hover:text-red-300">
                                    <i class="fas fa-times"></i>
                                </button>
            </div>
                            <button 
                                @click="addAttribute" 
                                class="text-sm text-gray-400 hover:text-gray-300 border border-dashed border-gray-600 px-3 py-2 rounded-lg w-full"
                            >
                                <i class="fas fa-plus mr-1"></i>Adicionar Atributo
                            </button>
        </div>
                        <textarea 
                            v-model="currentItem.notes" 
                            placeholder="Observações (opcional)" 
                            class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 h-20"
                        ></textarea>
                        </div>
                    <div class="flex gap-2 mt-4">
                        <button 
                            @click="closeItemModal" 
                            class="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            @click="saveItem" 
                            class="flex-1 px-4 py-3 bg-yellow-600 hover:bg-yellow-700 rounded-lg transition-colors"
                        >
                            Salvar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `,
    setup() {
        const inventory = inject('inventory');
        const saveInventory = inject('saveInventory');
        const sheetData = inject('sheetData');
        const handleImageError = inject('handleImageError');
        const showCreateItemModal = inject('showCreateItemModal');
        const editingItemIndex = inject('editingItemIndex');
        const currentItem = inject('currentItem');
        const attrNames = inject('attrNames');
        const editItem = inject('editItem');
        const removeItem = inject('removeItem');
        const addAttribute = inject('addAttribute');
        const removeAttribute = inject('removeAttribute');
        const updateAttributeName = inject('updateAttributeName');
        const closeItemModal = inject('closeItemModal');
        const saveItem = inject('saveItem');
        
        return {
            inventory,
            sheetData,
            saveInventory,
            handleImageError,
            showCreateItemModal,
            editingItemIndex,
            currentItem,
            attrNames,
            editItem,
            removeItem,
            addAttribute,
            removeAttribute,
            updateAttributeName,
            closeItemModal,
            saveItem
        };
    }
};

const GmTools = {
    template: `
        <div class="space-y-4">
            <div class="bg-gray-900 p-4 rounded-lg border border-gray-700">
                <h3 class="font-bold text-sm mb-3 text-red-400">
                    <i class="fas fa-crown mr-2"></i>Criar Conteúdo
                </h3>
                <div class="grid grid-cols-2 gap-2">
                    <button @click="openContentModal('monster')" class="bg-red-900 hover:bg-red-800 p-3 rounded-lg text-white text-sm transition-colors">
                        <i class="fas fa-dragon mb-1 block"></i>Monstro
                    </button>
                    <button @click="openContentModal('item')" class="bg-yellow-900 hover:bg-yellow-800 p-3 rounded-lg text-white text-sm transition-colors">
                        <i class="fas fa-gem mb-1 block"></i>Item
                    </button>
                    <button @click="openContentModal('condition')" class="bg-orange-900 hover:bg-orange-800 p-3 rounded-lg text-white text-sm transition-colors">
                        <i class="fas fa-exclamation-triangle mb-1 block"></i>Condição
                    </button>
                    <button @click="openContentModal('scenario')" class="bg-green-900 hover:bg-green-800 p-3 rounded-lg text-white text-sm transition-colors">
                        <i class="fas fa-map mb-1 block"></i>Cenário
                    </button>
                </div>
            </div>
            <div class="bg-gray-900 p-4 rounded-lg border border-gray-700">
                <h3 class="font-bold text-sm mb-2 text-gray-300">Jogadores</h3>
                <button @click="togglePlayersList" class="w-full bg-gray-700 hover:bg-gray-600 p-2 rounded-lg text-white text-sm transition-colors">
                    <i class="fas fa-users mr-2"></i>Ver Jogadores ({{ playersList.length }})
                </button>
                </div>
            </div>
    `,
    setup() {
        return {
            openContentModal: inject('openContentModal'),
            togglePlayersList: inject('togglePlayersList'),
            playersList: inject('playersList')
        };
    }
};

const MonsterForm = {
    template: `
        <div class="space-y-4">
            <input v-model="monsterData.name" placeholder="Nome do Monstro" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
            <textarea v-model="monsterData.desc" placeholder="Descrição" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 h-24"></textarea>
            <div class="grid grid-cols-3 gap-2">
                <input v-model="monsterData.hp" placeholder="HP" type="number" class="p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
                <input v-model="monsterData.ac" placeholder="AC" type="number" class="p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
                <input v-model="monsterData.level" placeholder="Nível" type="number" class="p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
            </div>
            <input v-model="monsterData.image" placeholder="URL da Imagem" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
        </div>
    `,
    setup() {
        return { monsterData: inject('monsterData') };
    }
};

const ItemForm = {
    template: `
        <div class="space-y-4">
            <input v-model="itemData.name" placeholder="Nome do Item" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
            <textarea v-model="itemData.desc" placeholder="Descrição" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 h-32"></textarea>
            <input v-model="itemData.image" placeholder="URL da Imagem" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
    </div>
    `,
    setup() {
        return { itemData: inject('itemData') };
    }
};

const ConditionForm = {
    template: `
        <div class="space-y-4">
            <input v-model="conditionData.name" placeholder="Nome da Condição" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
            <textarea v-model="conditionData.desc" placeholder="Descrição" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 h-32"></textarea>
            </div>
    `,
    setup() {
        return { conditionData: inject('conditionData') };
    }
};

const ScenarioForm = {
    template: `
        <div class="space-y-4">
            <input v-model="scenarioData.name" placeholder="Nome do Cenário" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
            <textarea v-model="scenarioData.desc" placeholder="Descrição" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400 h-32"></textarea>
            <input v-model="scenarioData.image" placeholder="URL da Imagem" class="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-400">
</div>
    `,
    setup() {
        return { scenarioData: inject('scenarioData') };
    }
};

createApp({
    setup() {
        // (rest of setup function from index.html should be moved here)
        // For brevity in this refactor step, core logic remains inline in HTML.
        return {};
    },
    components: {
        'gm-config': GmConfig,
        'player-sheet': PlayerSheet,
        'player-inventory': PlayerInventory,
        'gm-tools': GmTools,
        'monster-form': MonsterForm,
        'item-form': ItemForm,
        'condition-form': ConditionForm,
        'scenario-form': ScenarioForm
    }
}).mount('#app');

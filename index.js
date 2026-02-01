require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const express = require('express');
const crypto = require('crypto');
const app = express();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

client.once('ready', () => {
    console.log(`Bot logado como ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'add_categoria') {
            const nome = interaction.options.getString('nome');
            db.run("INSERT INTO categories (name) VALUES (?)", [nome], function(err) {
                if (err) return interaction.reply({ content: 'Erro ao adicionar categoria ou ela já existe.', ephemeral: true });
                interaction.reply({ content: `Categoria **${nome}** adicionada com sucesso!`, ephemeral: true });
            });
        }

        if (commandName === 'add_item') {
            const nome = interaction.options.getString('nome');
            const arquivo = interaction.options.getString('arquivo');
            const preco = interaction.options.getNumber('preco');
            const estoque = interaction.options.getInteger('estoque');
            const pix = interaction.options.getString('pix');
            const categoriaNome = interaction.options.getString('categoria');
            const download = interaction.options.getString('download');

            db.get("SELECT id FROM categories WHERE name = ?", [categoriaNome], (err, row) => {
                if (!row) return interaction.reply({ content: 'Categoria não encontrada!', ephemeral: true });
                
                db.run("INSERT INTO items (name, file_name, price, stock, pix_key, category_id, download_link) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [nome, arquivo, preco, estoque, pix, row.id, download], function(err) {
                        if (err) return interaction.reply({ content: 'Erro ao adicionar item.', ephemeral: true });
                        interaction.reply({ content: `Item **${nome}** adicionado com sucesso na categoria **${categoriaNome}**!`, ephemeral: true });
                    });
            });
        }

        if (commandName === 'painel') {
            const embed = new EmbedBuilder()
                .setTitle('🛒 Loja de Vendas')
                .setDescription('Clique no botão abaixo para ver os itens disponíveis.')
                .setColor('#0099ff');

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ver_itens')
                        .setLabel('Ver Itens')
                        .setStyle(ButtonStyle.Primary),
                );

            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'accept') {
            const user = interaction.options.getUser('usuario');
            const ip = interaction.options.getString('ip');
            const key = crypto.randomBytes(8).toString('hex').toUpperCase();

            db.run("INSERT INTO sales (user_id, ip_address, license_key, status) VALUES (?, ?, ?, 'active')",
                [user.id, ip, key], async function(err) {
                    if (err) return interaction.reply({ content: 'Erro ao gerar key.', ephemeral: true });
                    
                    try {
                        const embed = new EmbedBuilder()
                            .setTitle('✅ Pagamento Aprovado!')
                            .setDescription(`Sua compra foi processada com sucesso.\n\n**Key:** \`${key}\`\n**IP Vinculado:** \`${ip}\`\n\n*Esta key é de uso exclusivo para o IP informado.*`)
                            .setColor('#00ff00');

                        await user.send({ embeds: [embed] });
                        interaction.reply({ content: `Pagamento aceito para ${user.tag}. Key enviada no PV.`, ephemeral: true });
                        
                        // Opcional: Fechar o canal automaticamente após aceitar
                        setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
                    } catch (e) {
                        interaction.reply({ content: `Pagamento aceito, mas não consegui enviar DM para o usuário. Key: \`${key}\``, ephemeral: true });
                    }
                });
        }

        if (commandName === 'recuse') {
            const user = interaction.options.getUser('usuario');
            const motivo = interaction.options.getString('motivo');

            try {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Pagamento Recusado')
                    .setDescription(`Infelizmente seu pagamento não pôde ser validado.\n\n**Motivo:** ${motivo}`)
                    .setColor('#ff0000');

                await user.send({ embeds: [embed] });
                interaction.reply({ content: `Pagamento recusado para ${user.tag}. Motivo enviado no PV.`, ephemeral: true });
                
                // Fecha o canal instantaneamente como solicitado
                setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
            } catch (e) {
                interaction.reply({ content: `Erro ao enviar DM de recusa.`, ephemeral: true });
            }
        }
    }

    // Lógica de Botões (Fase 3)
    if (interaction.isButton()) {
        if (interaction.customId === 'fechar_ticket') {
            await interaction.reply('Fechando o ticket em 5 segundos...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }

        if (interaction.customId === 'ver_itens') {
            db.all("SELECT items.*, categories.name as cat_name FROM items JOIN categories ON items.category_id = categories.id", (err, rows) => {
                if (err || rows.length === 0) return interaction.reply({ content: 'Nenhum item disponível no momento.', ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle('📦 Itens Disponíveis')
                    .setColor('#00ff00');

                const selectMenu = {
                    type: 3, // String Select Menu
                    custom_id: 'comprar_item',
                    placeholder: 'Selecione um item para comprar',
                    options: rows.map(item => ({
                        label: item.name,
                        description: `R$ ${item.price.toFixed(2)} - Estoque: ${item.stock} (${item.cat_name})`,
                        value: item.id.toString()
                    }))
                };

                const row = new ActionRowBuilder().addComponents(selectMenu);
                interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            });
        }
    }

    // Lógica de Select Menu (Fase 3)
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'comprar_item') {
            const itemId = interaction.values[0];
            
            db.get("SELECT * FROM items WHERE id = ?", [itemId], async (err, item) => {
                if (!item) return interaction.reply({ content: 'Item não encontrado.', ephemeral: true });

                const guild = interaction.guild;
                const channel = await guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ],
                });

                const embed = new EmbedBuilder()
                    .setTitle('💳 Pagamento - ' + item.name)
                    .setDescription(`Olá ${interaction.user}, você selecionou o item **${item.name}**.\n\n**Valor:** R$ ${item.price.toFixed(2)}\n**Chave PIX:** \`${item.pix_key}\`\n\nEnvie o comprovante (imagem) aqui e aguarde a verificação.\n\n**ID do Item:** ${item.id}\n**ID do Comprador:** ${interaction.user.id}`)
                    .setColor('#ffff00')
                    .setFooter({ text: 'Use /accept ou /recuse para gerenciar este ticket' });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('fechar_ticket')
                            .setLabel('Fechar Ticket')
                            .setStyle(ButtonStyle.Danger)
                    );

                await channel.send({ embeds: [embed], components: [row] });
                interaction.reply({ content: `Ticket criado: ${channel}`, ephemeral: true });
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

app.get('/validate/:key/:ip', (req, res) => {
    const { key, ip } = req.params;
    db.get("SELECT * FROM sales WHERE license_key = ? AND ip_address = ? AND status = 'active'", [key, ip], (err, row) => {
        if (row) {
            res.json({ valid: true });
        } else {
            res.json({ valid: false });
        }
    });
});

app.listen(3000, () => console.log('API de validação rodando na porta 3000'));
